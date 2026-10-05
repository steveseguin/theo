// Run with: node --test tests/image-send-lifecycle.test.cjs
// Optional THEO_HTML selects an unmodified baseline index.html for comparison.
// Executes the complete application script with inert DOM/transport fixtures.
// Image encoding is deferred explicitly; no browser, image codec, or network runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(process.env.THEO_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.value = '';
    this.className = '';
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: name => { this.className = this.className.split(/\s+/).filter(v => v !== name).join(' '); },
    };
  }
  get innerHTML() { return this.html || ''; }
  set innerHTML(v) { this.html = v; this.children = []; }
  get firstChild() { return this.children[0]; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1]; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(v => v !== child);
    child.parentNode = this;
    const index = this.children.indexOf(before);
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    return child;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  dispatch(name, event = {}) { for (const handler of this.listeners[name] || []) handler.call(this, event); }
  focus() {}
  querySelector(selector) {
    const matches = element => {
      if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
      if (selector.startsWith('#')) return element.id === selector.slice(1);
      const attribute = selector.match(/^\[([^=]+)="(.*)"\]$/);
      if (attribute) return element.getAttribute(attribute[1]) === attribute[2];
      return element.tagName.toLowerCase() === selector;
    };
    for (const child of this.children) {
      if (matches(child)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

function fixture(search = '?session=fixture-room') {
  const body = new Element('body');
  const document = new Element('document');
  document.body = body;
  document.appendChild(body);
  document.createElement = tag => new Element(tag);
  document.getElementById = id => body.querySelector('#' + id);
  for (const id of ['chat-container', 'input-container', 'user-input', 'mic-button']) {
    assert.match(html, new RegExp('id="' + id + '"'));
    const element = new Element(id === 'user-input' ? 'input' : id === 'mic-button' ? 'button' : 'div');
    element.id = id;
    (['user-input', 'mic-button'].includes(id) ? document.getElementById('input-container') : body).appendChild(element);
  }
  const sent = [], alerts = [], pending = [];
  let nextId = 0;
  const context = vm.createContext({
    document, URLSearchParams, console: { log() {}, error() {} },
    marked: { setOptions() {}, parse: s => s },
    alert: value => alerts.push(value), setTimeout() {},
    Math: Object.assign(Object.create(Math), { random: () => ++nextId / 100 }),
    FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,preview'; this.onloadend?.(); } },
  });
  context.window = context;
  context.location = { search };
  context.addEventListener = () => {};
  vm.runInContext(script, context, { filename: 'index.html:inline' });
  document.dispatch('DOMContentLoaded');
  document.querySelector('iframe').contentWindow = { postMessage: value => sent.push(value.sendData.overlayNinja) };
  context.processImageForWebRTC = (file, size, dimension, message) => new Promise((resolve, reject) => pending.push({ file, message, resolve, reject }));
  const input = document.getElementById('user-input');
  return {
    context, document, input, sent, alerts, pending,
    history: () => JSON.parse(vm.runInContext('JSON.stringify(conversationHistory)', context)),
    selected: () => vm.runInContext('currentImageFile', context),
    select(name) {
      const file = { name, type: 'image/png' };
      const imageInput = document.getElementById('image-input');
      imageInput.value = name;
      imageInput.dispatch('change', { target: { files: [file] } });
      return file;
    },
  };
}

test('normal text and completed response retain conversation history', async () => {
  const f = fixture(); f.input.value = 'hello';
  await f.context.sendMessage();
  assert.equal(f.sent.length, 1);
  f.context.updateWaitingMessage(f.sent[0].target, 'reply');
  assert.deepEqual(f.history(), [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'reply' }]);
  assert.equal(f.input.value, '');
});

test('normal image submission sends its encoding and clears its own draft', async () => {
  const f = fixture(); f.select('A.png'); f.input.value = 'describe A';
  const operation = f.context.sendMessage();
  assert.equal(f.pending[0].file.name, 'A.png');
  f.pending[0].resolve('encoded-A'); await operation;
  assert.deepEqual(Array.from(f.sent[0].images), ['encoded-A']);
  assert.equal(f.selected(), null);
  assert.equal(f.input.value, '');
  assert.equal(f.document.querySelector('.image-preview-container').style.display, 'none');
});

test('New Chat ignores late responses to already submitted messages', async () => {
  const f = fixture(); f.input.value = 'old'; await f.context.sendMessage();
  const id = f.sent[0].target; f.context.newConversation(); f.context.updateWaitingMessage(id, 'late');
  assert.deepEqual(f.history(), []);
  assert.equal(f.document.getElementById('chat-container').children.length, 0);
});

test('New Chat cancels a pending image send without erasing a new draft', async () => {
  const f = fixture(); f.select('A.png'); f.input.value = 'old-image-question';
  const operation = f.context.sendMessage();
  f.context.newConversation(); f.input.value = 'new-unsent-draft';
  f.pending[0].resolve('encoded-A'); await operation;
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.history(), []);
  assert.equal(f.input.value, 'new-unsent-draft');
  assert.equal(f.document.getElementById('chat-container').children.length, 0);
});

test('repeated Send during image processing submits once', async () => {
  const f = fixture(); f.select('A.png'); f.input.value = 'describe A';
  const first = f.context.sendMessage(), second = f.context.sendMessage();
  f.pending.forEach(p => p.resolve('encoded-A')); await Promise.all([first, second]);
  assert.equal(f.sent.length, 1);
  assert.equal(f.history().filter(v => v.role === 'user').length, 1);
});

test('image completion preserves replacement attachment and edited text', async () => {
  const f = fixture(); f.select('A.png'); f.input.value = 'describe A';
  const operation = f.context.sendMessage();
  const replacement = f.select('B.png'); f.input.value = 'describe B next';
  f.pending[0].resolve('encoded-A'); await operation;
  assert.equal(f.selected(), replacement);
  assert.equal(f.input.value, 'describe B next');
  assert.equal(f.document.querySelector('.image-preview-container').style.display, 'inline-block');
  assert.equal(f.sent[0].images[0], 'encoded-A');
  const next = f.context.sendMessage(); f.pending[1].resolve('encoded-B'); await next;
  assert.equal(f.sent[1].images[0], 'encoded-B');
});

test('failed current encoding preserves draft and unlocks retry', async () => {
  const f = fixture(); const file = f.select('A.png'); f.input.value = 'retry me';
  const failed = f.context.sendMessage(); f.pending[0].reject(new Error('fixture failure')); await failed;
  assert.equal(f.alerts.length, 1); assert.equal(f.sent.length, 0);
  assert.equal(f.selected(), file); assert.equal(f.input.value, 'retry me');
  const retry = f.context.sendMessage(); f.pending[1].resolve('encoded-retry'); await retry;
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].images[0], 'encoded-retry');
});

test('stale encoding failure after New Chat is silent', async () => {
  const f = fixture(); f.select('A.png'); f.input.value = 'old';
  const old = f.context.sendMessage(); f.context.newConversation(); f.input.value = 'fresh draft';
  f.pending[0].reject(new Error('stale fixture failure')); await old;
  assert.equal(f.alerts.length, 0); assert.equal(f.sent.length, 0);
  assert.equal(f.input.value, 'fresh draft');
});

test('stale completion cannot unlock or clear the newer pending image send', async () => {
  const f = fixture(); f.select('A.png'); f.input.value = 'old';
  const old = f.context.sendMessage(); f.context.newConversation();
  const newFile = f.select('B.png'); f.input.value = 'new';
  const fresh = f.context.sendMessage();
  f.pending[0].resolve('encoded-A'); await old;
  assert.equal(f.selected(), newFile); assert.equal(f.input.value, 'new');
  const duplicate = f.context.sendMessage();
  assert.equal(f.pending.length, 2);
  f.pending[1].resolve('encoded-B'); await Promise.all([fresh, duplicate]);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].images[0], 'encoded-B');
  assert.deepEqual(f.history(), [{ role: 'user', content: 'new' }]);
});

test('stale completion after newer submission cannot alter new conversation', async () => {
  const f = fixture(); f.select('A.png'); f.input.value = 'old';
  const old = f.context.sendMessage(); f.context.newConversation();
  f.select('B.png'); f.input.value = 'new';
  const fresh = f.context.sendMessage(); f.pending[1].resolve('encoded-B'); await fresh;
  f.input.value = 'next draft'; f.pending[0].resolve('encoded-A'); await old;
  assert.equal(f.sent.length, 1); assert.equal(f.input.value, 'next draft');
  assert.deepEqual(f.history(), [{ role: 'user', content: 'new' }]);
});

test('model override and image-only submission remain supported', async () => {
  const f = fixture('?session=fixture-room&model=custom-model'); f.select('A.png');
  const operation = f.context.sendMessage(); f.pending[0].resolve('encoded-A'); await operation;
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].model, 'custom-model');
  assert.equal(f.sent[0].images[0], 'encoded-A');
});

test('empty Send remains a no-op', async () => {
  const f = fixture(); f.input.value = '   '; await f.context.sendMessage();
  assert.equal(f.sent.length, 0); assert.equal(f.pending.length, 0);
});

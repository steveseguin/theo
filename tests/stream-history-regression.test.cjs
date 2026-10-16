// Run with: node --test tests/stream-history-regression.test.cjs
// Optional THEO_HTML selects an unmodified baseline index.html for comparison.
// Executes the complete application script with inert DOM/transport fixtures.
// Exercises Enter and inbound response events with synthetic DOM and inert transport.
// No browser, backend, model API, image codec, or network runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(process.env.THEO_HTML || path.resolve(__dirname, '../index.html'), 'utf8');
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
  const windowHandlers = {};
  context.addEventListener = (name, callback) => { windowHandlers[name] = callback; };
  vm.runInContext(script, context, { filename: 'index.html:inline' });
  document.dispatch('DOMContentLoaded');
  document.querySelector('iframe').contentWindow = { postMessage: value => sent.push(value.sendData.overlayNinja) };
  context.processImageForWebRTC = (file, size, dimension, message) => new Promise((resolve, reject) => pending.push({ file, message, resolve, reject }));
  const input = document.getElementById('user-input');
  return {
    context, document, input, sent, alerts, pending,
    receive(id, content, chunk = false) {
      windowHandlers.message({ source: document.querySelector('iframe').contentWindow, data: { dataReceived: { overlayNinja: { [chunk ? 'chatbotChunk' : 'chatbotResponse']: { target: id, value: content } } } } });
    },
    async send(text) { input.value = text; input.dispatch('keypress', {key:'Enter'}); await Promise.resolve(); return sent.at(-1).target; },
    display(id) { return document.querySelector(`[data-response-id="${id}"]`)?.querySelector('.message-content')?.getAttribute('data-markdown'); },
    chunks() { return JSON.parse(vm.runInContext('JSON.stringify(messageChunks)', context)); },
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

test('single chunk-only answer enters history on next send', async()=>{
 const f=fixture(); const a=await f.send('question A');f.receive(a,'answer ',true);f.receive(a,'A',true);
 assert.deepEqual(f.history(),[{role:'user',content:'question A'}]);
 await f.send('question B');
 assert.deepEqual(f.history(),[{role:'user',content:'question A'},{role:'assistant',content:'answer A'},{role:'user',content:'question B'}]);
 assert.match(f.sent[1].value,/assistant: answer A\nuser: question B/);
});
test('second Enter while pending preserves both target buffers and first answer display',async()=>{
 const f=fixture(); const a=await f.send('A');const b=await f.send('B');assert.notEqual(a,b);assert.equal(f.sent.length,2);
 f.receive(a,'answer A',true);f.receive(b,'answer B',true);
 assert.equal(f.display(a),'answer A');assert.equal(f.display(b),'answer B');
 assert.deepEqual(Object.keys(f.chunks()).sort(),[String(a),String(b)].sort());
});
test('interleaved chunk-only answers keep updating existing history entries',async()=>{
 const f=fixture();const a=await f.send('A');f.receive(a,'A1',true);const b=await f.send('B');
 f.receive(a,'A2',true);f.receive(b,'B1',true);const c=await f.send('C');
 f.receive(a,'A3',true);f.receive(b,'B2',true);
 assert.equal(f.display(a),'A1A2A3');assert.equal(f.display(b),'B1B2');
 assert.deepEqual(f.history(),[{role:'user',content:'A'},{role:'assistant',content:'A1A2A3'},{role:'user',content:'B'},{role:'assistant',content:'B1B2'},{role:'user',content:'C'}]);
 assert.match(f.sent[2].value,/assistant: A1A2\nuser: B\nassistant: B1\nuser: C/);
});
test('full finals replace previously flushed partial entries without duplicates',async()=>{
 const f=fixture();const a=await f.send('A');f.receive(a,'partial A',true);const b=await f.send('B');
 f.receive(b,'partial B',true);await f.send('C');f.receive(b,'full B');f.receive(a,'full A');await f.send('D');
 const answers=f.history().filter(x=>x.role==='assistant' && x.content);
 assert.deepEqual(answers,[{role:'assistant',content:'full A'},{role:'assistant',content:'full B'}]);
 assert.equal(f.display(a),'full A');assert.equal(f.display(b),'full B');
 assert.ok(!(a in f.chunks()));assert.ok(!(b in f.chunks()));
 assert.equal((f.sent[3].value.match(/assistant: full A/g)||[]).length,1);assert.ok(!f.sent[3].value.includes('partial'));
});
test('normal final-only answer remains in next request exactly once',async()=>{
 const f=fixture();const a=await f.send('A');f.receive(a,'full A');await f.send('B');
 assert.deepEqual(f.history(),[{role:'user',content:'A'},{role:'assistant',content:'full A'},{role:'user',content:'B'}]);assert.equal(f.display(a),'full A');assert.ok(!(a in f.chunks()));
});
test('final-only answer arriving after next send fills its existing placeholder',async()=>{
 const f=fixture();const a=await f.send('A');await f.send('B');f.receive(a,'full A');
 assert.deepEqual(f.history(),[{role:'user',content:'A'},{role:'assistant',content:'full A'},{role:'user',content:'B'}]);
});
test('duplicate full final updates one history entry',async()=>{
 const f=fixture();const a=await f.send('A');f.receive(a,'full A');f.receive(a,'full A');assert.equal(f.history().filter(x=>x.role==='assistant').length,1);
});
test('New Chat removes buffers and history ownership; old events stay ignored',async()=>{
 const f=fixture();const a=await f.send('A');f.receive(a,'old partial',true);await f.send('B');f.context.newConversation();
 f.receive(a,'late chunk',true);f.receive(a,'late full');assert.deepEqual(f.history(),[]);assert.deepEqual(f.chunks(),{});
 const c=await f.send('C');f.receive(c,'fresh full');assert.deepEqual(f.history(),[{role:'user',content:'C'},{role:'assistant',content:'fresh full'}]);assert.equal(f.display(a),undefined);
});
test('late chunk after a full final cannot overwrite completed display/history',async()=>{
 const f=fixture();const a=await f.send('A');f.receive(a,'full');f.receive(a,'late',true);assert.equal(f.display(a),'full');assert.equal(f.history()[1].content,'full');
});

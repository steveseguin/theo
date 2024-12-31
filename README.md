# Theo - WebRTC-Based Private LLM Chat Interface

A secure, peer-to-peer chatbot interface that connects to self-hosted LLMs via WebRTC, powered by VDO.Ninja. This implementation ensures private communications while providing a rich, modern chat experience with multimodal capabilities.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

## Features

- **Secure P2P Communication**: Utilizes WebRTC for direct peer-to-peer connections, keeping your LLM service behind your firewall
- **Vision Support**: Process and analyze images alongside text queries
- **Speech Recognition**: Built-in speech-to-text capabilities for voice interaction
- **Modern UI**: Clean, responsive interface with dark mode and modern design elements
- **Markdown Support**: Full markdown rendering for rich text responses
- **Code Highlighting**: Proper formatting and display of code snippets
- **Mobile Responsive**: Fully functional on mobile devices
- **Copy Functionality**: Easy copy-to-clipboard for any message
- **Real-time Streaming**: Character-by-character streaming of LLM responses
- **Conversation Management**: Support for maintaining and clearing conversation history

## Prerequisites

- A self-hosted LLM service
- A modern web browser supporting WebRTC
- Access to VDO.Ninja's service (free)

## Setup

1. Clone this repository:
```bash
git clone https://github.com/yourusername/theo-llm-chat.git
```

2. Configure your environment:
   - Set up your LLM endpoint
   - Configure your VDO.Ninja room ID and credentials
   - Update any desired model parameters

3. Deploy the HTML file to your web server or open locally.

## Configuration

Key configuration options are available through URL parameters:

- `session`: VDO.Ninja room identifier
- `password`: Optional room password
- `model`: LLM model selection

Example URL:
```
https://yourserver.com/theo.html?session=yourroom&password=yourpass&model=your-model
```

## Integration with VDO.Ninja

This LLM Chatbot implementation leverages VDO.Ninja's IFRAME API for WebRTC data channels:

```javascript
iframe.src = `https://vdo.socialstream.ninja/?ln&password=${password}&salt=vdo.ninja&label=chatbot&view=${roomID}&scene&novideo&noaudio&cleanoutput&room=${roomID}`;
```

## Security Features

- End-to-end encrypted communications with LLM via WebRTC
- No direct exposure of your LLM API to Internet
- Optional room password protection
- Client-side processing of sensitive data

## Upcoming Features

- Text-to-Speech support
- Additional model support
- Enhanced image processing capabilities
- Custom styling options
- Advanced conversation management
- File attachment support

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- VDO.Ninja for their excellent WebRTC platform
- marked.js for markdown rendering
- Contributors to the WebRTC standard

## Disclaimer

This implementation includes support for uncensored LLM interactions. Please ensure compliance with all applicable laws and regulations in your jurisdiction when deploying this solution.

# 📞 VoiceFlow (ARI Stasi Server)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-23.x-green.svg)](https://nodejs.org/)
[![Asterisk](https://img.shields.io/badge/Asterisk-ARI-red.svg)](https://wiki.asterisk.org/wiki/display/AST/Asterisk+REST+Interface+(ARI))
[![License: Non-Commercial](https://img.shields.io/badge/License-Non--Commercial-orange.svg)](LICENSE)

<p align="center">
  <!-- Replace with your own logo when available -->
  <img src="./header.webp" alt="VoiceFlow Logo" width="100%" />
  <br>
  <em><a href="https://asterisk.org"><img src="https://asterisk.org/wp-content/uploads/asterisk-logo.png" alt="Asterisk" width="50" style="vertical-align: middle;"/></a>-powered telephony management with speech recognition and transcription</em>
</p>

---

## 📋 Overview

TranscriptARI is a sophisticated telephony management system built on Asterisk's ARI (Asterisk REST Interface). It provides voice call handling, transcription, and PBX control capabilities. The system combines WebSockets, RTP, and Google Speech-to-Text integration to create a modern, feature-rich telephony solution.

## ✨ Key Features

- 🔄 **Call Management** - Handles incoming and outgoing calls through Asterisk PBX
- 🎙️ **Speech-to-Text** - Real-time transcription of calls using Google Cloud Speech API  
- 🌉 **Bridge Management** - Creates and manages voice bridges for connecting multiple channels
- 👥 **Contact Recognition** - Supports voice-activated dialing using a contacts database
- 📡 **External Media Channels** - Supports external media integration for advanced use cases
- 🔌 **WebSocket Interface** - Provides real-time updates and control via WebSockets

## 🏗️ Architecture

The system is built on TypeScript and Node.js with a modular architecture supporting **multiple concurrent calls**:

```mermaid
flowchart TD
    A[📞 Incoming Call 1] --> B[CallSessionManager]
    C[📞 Incoming Call 2] --> B
    B --> D[Session 1: Bridge 1]
    B --> E[Session 2: Bridge 2]
    D --> F[External Media 1]
    E --> G[External Media 2]
    F --> H[🎙️ Transcriber]
    G --> H
    H -->|routed by session ID| D
    H -->|routed by session ID| E
```

### Core Components

<details>
<summary><b>🎮 AriControllerServer</b></summary>
<p>

The main controller that interfaces with Asterisk PBX:
- Manages call flows, bridges, and DTMF input
- Handles Stasis application events (start, end)
- Provides WebSocket server for client connections
- Manages contact lookups for voice-activated dialing

</p>
</details>

<details>
<summary><b>🔤 AriTranscriberServer</b></summary>
<p>

Provides real-time speech transcription:
- Connects to Google Cloud Speech API
- Processes RTP audio streams
- Transmits transcription results via WebSockets
- Supports customizable language and model settings

</p>
</details>

<details>
<summary><b>📡 RTP UDP Server</b></summary>
<p>

Handles the real-time audio streaming:
- Processes incoming RTP packets from Asterisk
- Handles audio format conversion for transcription

</p>
</details>

<details>
<summary><b>🗣️ Google Speech Provider</b></summary>
<p>

Integration with Google's Speech-to-Text API:
- Handles streaming transcription with automatic restarts
- Manages audio chunking for optimal performance
- Provides both interim and final transcription results

</p>
</details>

## ⚙️ Configuration

The system uses environment variables for configuration, including:

| Category | Variables |
|----------|-----------|
| PBX | PBX IP address, login credentials |
| WebSocket | Server ports, external host information |
| Transcription | Language settings, model configuration |
| Telephony | Provider settings, phone numbers |

## 🚀 Getting Started

<img src="https://cdn-icons-png.flaticon.com/512/4961/4961854.png" alt="Setup" width="50" align="right"/>

1. Set up a FreePBX server - [FreePBX Server Installation and Configuration Guide](freepbx-setup.md)
2. Configure environment variables in `.env` file (see `env.example` for reference)
3. Set up Google Cloud credentials for speech recognition
4. Configure contacts in `tools/contacts.json` for voice-activated dialing
5. Start the system with:
   ```bash
   npm start
   ```
   or
   ```bash
   npx ts-node -T core/manager.ts
   ```

## 💡 Use Cases

<div style="display: flex; flex-wrap: wrap; gap: 20px;">
  <div style="flex: 1; min-width: 250px;">
    <h3>📞 Voice Call Center</h3>
    <p>Handle incoming calls with transcription for record-keeping</p>
  </div>
  <div style="flex: 1; min-width: 250px;">
    <h3>🤖 Automated Calling Systems</h3>
    <p>Set up outbound call campaigns with speech recognition</p>
  </div>
  <div style="flex: 1; min-width: 250px;">
    <h3>🗣️ Voice-Activated Dialing</h3>
    <p>Allow callers to speak names instead of dialing numbers</p>
  </div>
  <div style="flex: 1; min-width: 250px;">
    <h3>📝 Call Recording with Transcription</h3>
    <p>Keep searchable records of call content</p>
  </div>
</div>

## 📦 Dependencies

- **Asterisk PBX** with ARI enabled
- **Node.js** and TypeScript
- **Google Cloud Speech API** credentials
- Various NPM packages including:
  ```
  ari-client, @google-cloud/speech, ws, express, dotenv
  ```

## 🔮 Future Improvements

- 🔧 Enhanced typing for typescript
- 🖥️ WEB UI for for monitoring and management
- 🔊 Additional speech recognition providers like self hosted whisper model or Scribe from ElevenLabs
- 📊 Call analytics and reporting features

## 📜 License

This project is licensed under a **Non-Commercial License (MIT-Based)** - see the [LICENSE](LICENSE) file for details.

### Summary

- ✅ **Free for non-commercial use** - Use, modify, and distribute for personal and educational purposes
- 💼 **Commercial use requires permission** - Contact for commercial licensing
- 📧 **Get in touch**: Discord: `alexispace`

**Key Points:**
- The software is provided "as is" without warranty
- Attribution is required in all copies
- Commercial use requires explicit permission from the copyright holder

For the full license text, please refer to the [LICENSE](LICENSE) file.

---

<div align="center">
  <p>Built with ❤️ for modern telephony solutions</p>
</div>
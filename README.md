# 📞 AriLink

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-23.x-green.svg)](https://nodejs.org/)
[![Asterisk](https://img.shields.io/badge/Asterisk-ARI-red.svg)](https://wiki.asterisk.org/wiki/display/AST/Asterisk+REST+Interface+(ARI))
[![License: ACL v1.0](https://img.shields.io/badge/License-ACL--1.0-orange.svg)](LICENSE)

<p align="center">
  <!-- Replace with your own logo when available -->
  <img src="./assets/header.webp" alt="AriLink Logo" width="100%" />
  <br>
  <em><a href="https://asterisk.org"><img src="https://asterisk.org/wp-content/uploads/asterisk-logo.png" alt="Asterisk" width="50" style="vertical-align: middle;"/></a>-powered telephony management with speech recognition and transcription</em>
</p>

---

## 📋 Overview

AriLink is a telephony management system built on Asterisk's ARI (Asterisk REST Interface). It provides voice call handling, transcription, and PBX control capabilities. The system combines WebSockets, RTP, and speech-to-text integration to create a modern, feature-rich telephony solution.

## ✨ Key Features

- 🔄 **Call Management** - Handles incoming and outgoing calls through Asterisk PBX
- 🎙️ **Speech-to-Text** - Real-time transcription using local AI models (Parakeet, Whisper) or Google Cloud
- 🌉 **Bridge Management** - Creates and manages voice bridges for connecting multiple channels
- 👥 **Contact Recognition** - Supports voice-activated dialing using a contacts database
- 📡 **External Media Channels** - Supports external media integration for advanced use cases
- 🔌 **WebSocket Interface** - Provides real-time updates and control via WebSockets
- 🔁 **Automatic Fallback** - Seamlessly switches to backup transcription services if primary fails

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
<summary><b>📡 Rust RTP Server</b></summary>
<p>

High-performance audio pipeline (replaces legacy Node.js RTP/transcription):
- Receives RTP audio from Asterisk ExternalMedia channels
- Per-session audio routing with codec handling (slin16)
- Forwards audio to configurable transcription services (Parakeet, Google Cloud Speech)
- Automatic fallback between transcription providers
- WebSocket bridge for real-time transcription results

</p>
</details>

<details>
<summary><b>🗣️ Transcription Providers</b></summary>
<p>

Multiple transcription backend support:
- **Local providers**: Parakeet TDT, Whisper (runs on your GPU)
- **Cloud provider**: Google Speech-to-Text API (optional)
- Handles streaming transcription with automatic restarts
- Manages audio chunking for optimal performance
- Provides both interim and final transcription results
- Automatic failover between services

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

### Prerequisites

1. **Set up FreePBX server**:
   - 📦 **New installation?** [FreePBX Installation Guide](docs/freepbx-setup.md) - VM setup and FreePBX installation
   - ⚙️ **Already installed?** [FreePBX ARI Configuration](docs/FREEPBX-ARI-CONFIGURATION.md) - Configure for AriLink
2. **Install UV** (Python package manager):
   ```powershell
   # Windows PowerShell
   irm https://astral.sh/uv/install.ps1 | iex
   ```

### Installation & Startup

1. **Clone and Install everything** (One command for all Node dependencies):
   ```bash
   npm install
   ```
   > [!TIP]
   > This automatically installs both the core server and the interactive dashboard dependencies.

2. **Setup Transcription Service** (Local speech recognition):
   Choose one and install its dependencies (requires [UV](https://astral.sh/uv/)):
   ```bash
   # For Parakeet (Recommended)
   cd transcription-services/parakeet-service && uv pip install -r requirements.txt
   
   # OR for Whisper
   cd transcription-services/whisper-service && uv pip install -r requirements.txt
   ```

3. **Start the system**:
   ```bash
   # Terminal 1: AI Service
   cd transcription-services/parakeet-service && ./start-service.bat
   
   # Terminal 2: AriLink (Choose one mode)
   npm run dev   # Best for development (Live Reload)
   npm start     # Best for production (Builds & Starts)
   ```

### ⚙️ Configuration
The system uses a central `.env` file. You can manage this via the **Config** page in the dashboard once the server is running.
- See [`.env.example`](.env.example) for manual setup.
- Configure contacts in `tools/contacts.json` for voice-activated dialing.

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
- **Transcription Service** - choose one:
  - Local: Parakeet TDT 0.6B (RECOMMENDED) or Whisper
  - Cloud: Google Cloud Speech API credentials (optional)
- Various NPM packages including:
  ```
  ari-client, @google-cloud/speech, ws, socket.io, dotenv, better-sqlite3
  ```

## 🔮 Future Improvements

- 🔧 Enhanced typing for TypeScript
- 🖥️ Web UI for monitoring and management
- ✅ ~~Additional speech recognition providers~~ **DONE: Local Whisper model integrated!**
- 🔊 Additional providers: Scribe from ElevenLabs, Azure Speech
- 📊 Call analytics and reporting features
- 💾 Database persistence for call records and transcriptions

## 📜 License

This project is licensed under the **AriLink Community License (ACL) v1.0** - see the [LICENSE](LICENSE) file for details.

### Summary

- ✅ **Free for personal & internal use** - View, study, and modify for personal/internal use.
- 💼 **Commercial use restricted** - Internal commercial operations allowed; no redistribution or SaaS.
- 🚫 **No Redistribution** - You may not redistribute, white-label, or sell the software.
- 📧 **Commercial Licensing**: For SaaS hosting, resale, or third-party deployment, contact Alexi Pawelec (Discord: `alexispace`).

**Key Points:**
- The software is provided "as is" without warranty.
- Contributions grant the copyright holder perpetual rights to use/modify.
- Violation of terms automatically terminates the license.

For the full license text, please refer to the [LICENSE](LICENSE) file.

---

<div align="center">
  <p>Built with ❤️ for modern telephony solutions</p>
</div>
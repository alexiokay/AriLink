# AriLink

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-23.x-green.svg)](https://nodejs.org/)
[![Nuxt](https://img.shields.io/badge/Nuxt-4.3-00DC82.svg)](https://nuxt.com/)
[![Asterisk](https://img.shields.io/badge/Asterisk-ARI-red.svg)](https://wiki.asterisk.org/wiki/display/AST/Asterisk+REST+Interface+(ARI))
[![License: ACL v1.0](https://img.shields.io/badge/License-ACL--1.0-orange.svg)](LICENSE)

<p align="center">
  <img src="./assets/header.webp" alt="AriLink" width="100%" />
  <br>
  <em><a href="https://asterisk.org"><img src="https://asterisk.org/wp-content/uploads/asterisk-logo.png" alt="Asterisk" width="50" style="vertical-align: middle;"/></a>-powered telephony platform with real-time transcription, campaigns, and a full web dashboard</em>
</p>

---

## Overview

AriLink is a telephony platform built on Asterisk's ARI (Asterisk REST Interface). It combines a **Nuxt 4 web dashboard**, a **Rust RTP audio pipeline**, and **local AI transcription** into a single system for managing calls, running outbound campaigns, and monitoring everything in real time.

<p align="center">
  <img src="./assets/dashboard.png" alt="AriLink Dashboard" width="100%" />
</p>

## Key Features

- **Web Dashboard** - Full management UI with real-time service status, active calls, logs, and configuration
- **Call Management** - Incoming and outgoing calls through Asterisk PBX with live transcription
- **Campaign Engine** - Automated outbound dialing with configurable assistants and call scripts
- **Speech-to-Text** - Real-time transcription using local AI models (Parakeet TDT, Whisper) or Google Cloud
- **Pluggable Assistants** - Modular call logic (IVR transfer, direct dial, auto-dialer) with per-assistant configuration
- **Built-in Softphone** - SIP softphone directly in the dashboard for testing and manual calls
- **Call History** - SQLite-backed call records with search and transcription playback
- **SSH Terminal** - Remote PBX management directly from the dashboard
- **File Manager** - Upload and manage Asterisk audio files (prompts, greetings) via SFTP
- **Contact Management** - Voice-activated dialing using a contacts database
- **Automatic Fallback** - Seamlessly switches between transcription providers on failure

<p align="center">
  <img src="./assets/softphone.png" alt="Built-in Softphone" width="220" />
</p>

## Architecture

Built on **Nuxt 4 + Nitro** (single server for SPA, API, and Socket.IO), with a **Rust RTP server** for audio and **Python services** for transcription:

```mermaid
flowchart TD
    subgraph Dashboard["Nuxt 4 Dashboard"]
        UI[Vue 3 SPA]
        API[Nitro API Routes]
        SIO[Socket.IO]
    end

    subgraph Engine["Node.js Engine"]
        CTRL[ARI Controller]
        CAMP[Campaign Engine]
        HIST[Call History DB]
        LOG[Log Collector]
    end

    subgraph Audio["Rust RTP Server"]
        RTP[RTP Listener :8000]
        WS_BRIDGE[WebSocket Bridge]
    end

    subgraph Transcription["Transcription Services"]
        PKT[Parakeet TDT 0.6B]
        WHSP[Whisper]
        GCS[Google Cloud Speech]
    end

    PBX[Asterisk PBX] -->|ARI WebSocket| CTRL
    PBX -->|RTP Audio| RTP
    RTP --> WS_BRIDGE
    WS_BRIDGE -->|Audio Stream| PKT
    WS_BRIDGE -.->|Fallback| WHSP
    WS_BRIDGE -.->|Fallback| GCS
    PKT -->|Transcription| WS_BRIDGE
    WS_BRIDGE -->|Results| CTRL
    CTRL --> HIST
    CTRL --> LOG
    CAMP --> CTRL
    SIO <-->|Real-time| UI
    API --> HIST
    API --> LOG
    SIO <--> Engine
```

### Core Components

<details>
<summary><b>Engine</b></summary>

Orchestrates all backend services on startup:
- Starts the Rust RTP server and Parakeet transcription (in parallel)
- Connects to Asterisk ARI
- Wires up the Dashboard, Call History, and Campaign Engine
- Graceful shutdown of all child processes

</details>

<details>
<summary><b>ARI Controller</b></summary>

Interfaces with Asterisk PBX via ARI:
- Manages call flows, bridges, and DTMF input
- Delegates call logic to pluggable assistants
- Routes transcription results to active calls
- Handles contact lookups for voice-activated dialing

</details>

<details>
<summary><b>Rust RTP Server</b></summary>

High-performance audio pipeline:
- Receives RTP audio from Asterisk ExternalMedia channels
- Per-session audio routing with codec handling (slin16, Opus)
- Forwards audio to transcription services via WebSocket
- Automatic fallback between transcription providers

</details>

<details>
<summary><b>Transcription Providers</b></summary>

Multiple backend support with automatic failover:
- **Parakeet TDT 0.6B-v3** (recommended) - 25 languages, 2000x+ real-time speed, runs on GPU
- **Whisper** - Slower but highly accurate
- **Google Cloud Speech** - Cloud-based fallback (requires API credentials)
- Streaming transcription with interim and final results
- Priority chain configured via `TRANSCRIPTION_SERVICES` env var

</details>

<details>
<summary><b>Campaign Engine</b></summary>

Automated outbound dialing:
- Upload phone lists and run campaigns from the dashboard
- Configurable concurrency, retry logic, and call scripts
- Real-time campaign progress via Socket.IO
- Per-call results stored in campaign-results/

</details>

### Dashboard Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Service status (Asterisk, Rust RTP, Transcription), active calls |
| **Calls** | Call history with transcription, search, and playback |
| **Assets** | Upload/manage Asterisk audio files via SFTP |
| **Terminal** | SSH terminal for remote PBX management |
| **Campaigns** | Create and run outbound call campaigns |
| **Contacts** | Manage contacts for voice-activated dialing |
| **Assistants** | Configure call handling logic per assistant |
| **Logs** | Real-time and historical application logs |
| **Config** | Edit environment variables and server settings |
| **Docs** | Built-in documentation viewer |

## Getting Started

### Docker (Recommended)

The fastest way to try AriLink — no Node.js, Python, or Asterisk installation needed:

```bash
docker compose up -d
```

This starts Asterisk + AI transcription + Dashboard. Open [localhost:3011](http://localhost:3011).

**Test with a SIP phone** (Zoiper, Linphone): server `localhost:5060`, extension `1001`, password `demo1001`.

```bash
# With GPU transcription (NVIDIA)
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d

# With live code editing (mount local source)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

See [docs/docker.md](docs/docker.md) for full Docker guide, configuration, and troubleshooting.

### Manual Setup

For development or connecting to an existing FreePBX server:

#### Prerequisites

1. **Set up FreePBX server**:
   - New installation? [FreePBX Installation Guide](docs/freepbx-setup.md)
   - Already installed? [FreePBX ARI Configuration](docs/FREEPBX-ARI-CONFIGURATION.md)
2. **Node.js 23+** and **npm**
3. **UV** (Python package manager) for transcription services:
   ```powershell
   # Windows PowerShell
   irm https://astral.sh/uv/install.ps1 | iex
   ```

#### Installation

1. **Clone and install dependencies** (one command installs everything):
   ```bash
   npm install
   ```
   > This automatically installs both the core server and dashboard dependencies.

2. **Set up transcription** (local speech recognition):
   ```bash
   cd transcription-services/parakeet-service
   python -m venv .venv
   uv pip install -r requirements.txt
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your FreePBX IP, ARI credentials, etc.
   ```

#### Running

```bash
# Development (hot reload, auto-starts Parakeet if configured)
npm run dev

# Production (builds if needed, then starts)
npm start

# Build only
npm run build
```

> Set `AUTO_START_TRANSCRIPTION=true` in `.env` to have the launcher automatically start Parakeet in parallel with the server. No separate terminal needed.

The dashboard will be available at `http://localhost:3011`. All settings can be managed from the **Config** page once the server is running.

### Assistant Modes

```bash
npm run start:ivr        # IVR with transfer (default)
npm run start:dial       # Direct dial mode
npm run start:autodialer # Auto-dialer campaign mode
```

## Configuration

The system uses a central `.env` file. Key settings:

| Category | Variables |
|----------|-----------|
| **PBX** | `PBX_IP`, `ASTERISK_LOGIN`, `ASTERISK_PASSWORD` |
| **Transcription** | `TRANSCRIPTION_SERVICES`, `AUTO_START_TRANSCRIPTION`, `SPEECH_LANG` |
| **Server** | `PORT` (default 3011), `LISTENER_SERVER`, `EXTERNAL_HOST` |
| **Assistants** | `DEFAULT_ASSISTANT`, per-assistant `config.json` files |

See [`.env.example`](.env.example) for all options with documentation.

## Tech Stack

- **Frontend**: Nuxt 4, Vue 3.5, @nuxt/ui, Socket.IO client, SIP.js (softphone)
- **Backend**: Nitro (Node.js), TypeScript, Socket.IO, ari-client, better-sqlite3
- **Audio**: Rust RTP server (slin16, Opus), Asterisk ExternalMedia
- **Transcription**: Parakeet TDT 0.6B-v3 (NeMo), Whisper, Google Cloud Speech
- **Infrastructure**: Asterisk PBX (FreePBX), SSH/SFTP for remote management

## Roadmap

- ~~Web UI for monitoring and management~~ **Done**
- ~~Database persistence for call records~~ **Done**
- ~~Additional speech recognition providers~~ **Done**
- Additional providers: Scribe (ElevenLabs), Azure Speech, Deepgram
- Call analytics and reporting
- ~~One-click deployment (Docker)~~ **Done**
- Railway / cloud deployment
- Transcription management GUI (model downloads, provider config)

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full roadmap.

## License

This project is licensed under the **AriLink Community License (ACL) v1.0** - see the [LICENSE](LICENSE) file for details.

- **Free for personal & internal use** - View, study, and modify for personal/internal use.
- **Commercial use restricted** - Internal commercial operations allowed; no redistribution or SaaS.
- **No Redistribution** - You may not redistribute, white-label, or sell the software.
- **Commercial Licensing**: For SaaS hosting, resale, or third-party deployment, contact Alexi Pawelec (Discord: `alexispace`).

---

<div align="center">
  <p>Built with care for modern telephony</p>
</div>

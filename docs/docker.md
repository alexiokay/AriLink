# Docker Setup

Run the full AriLink stack (Asterisk + Transcription + Dashboard) with a single command.

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/AriLink/arilink.git
cd arilink

# 2. Start everything
docker compose up -d

# 3. Open dashboard
open http://localhost:3011
```

That's it. Three services start automatically:

| Service | Port | Description |
|---------|------|-------------|
| **Dashboard** | [localhost:3011](http://localhost:3011) | Web UI + API + Socket.IO |
| **Asterisk** | localhost:5060 (SIP), localhost:8088 (ARI) | PBX with ARI enabled |
| **Parakeet** | localhost:5000 | AI transcription (CPU) |

### Test with a SIP Phone

Register a softphone (Zoiper, Linphone, or the built-in softphone):

- **Server**: `localhost:5060`
- **Extension**: `1001`
- **Password**: `demo1001`

## Configuration

### Environment Variables

Create a `.env` file in the project root to override defaults:

```bash
# Asterisk credentials (defaults shown)
ASTERISK_LOGIN=arilink
ASTERISK_PASSWORD=arilink123
STASIS_APP_NAME=stasis-app

# Speech recognition language
SPEECH_LANG=en-US

# Default assistant mode
DEFAULT_ASSISTANT=ivr-transfer

# WebSocket secure port
WSS_PORT=3044
```

All variables with defaults are defined in `docker-compose.yml`. The `.env` file only needs to contain values you want to change.

### ARI Credentials

The Asterisk container uses `ASTERISK_LOGIN` and `ASTERISK_PASSWORD` to configure the ARI user. The AriLink app uses the same credentials to connect. Change them in `.env` and both services pick up the new values.

## GPU Transcription

For much faster transcription with an NVIDIA GPU:

```bash
# Requires: NVIDIA GPU + NVIDIA Container Toolkit
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

This swaps the Parakeet service to a CUDA-enabled image. Transcription goes from ~2x real-time (CPU) to ~2000x real-time (GPU).

### Prerequisites

1. NVIDIA GPU with CUDA 12.x support
2. [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) installed on the host

## Rust RTP Server (Optional)

For higher performance audio handling:

```bash
docker compose --profile rust-rtp up -d
```

This starts an additional Rust-based RTP server. Set `USE_RUST_RTP=true` in `.env` to route audio through it.

## Customizing Code (Live Editing)

If you want to modify assistants, call logic, or other code while running in Docker:

### Option 1: Mount Local Directories

Use the dev override to mount your local source into the container:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This mounts `core/` and `assistants/` as volumes, so you can edit files locally and restart the container to apply changes:

```bash
# Edit an assistant locally
code assistants/ivr-transfer/IvrTransferAssistant.ts

# Restart to pick up changes
docker compose restart arilink
```

### Option 2: Full Development Mode

For hot-reload development with the full Nuxt dev server:

```bash
# Install dependencies locally
npm install

# Start dev server (hot reload, no Docker needed for the app)
npm run dev
```

You can still run Asterisk and Parakeet in Docker while developing locally:

```bash
# Start only Asterisk + Parakeet
docker compose up -d asterisk parakeet

# Run the app locally with hot reload
PBX_IP=localhost TRANSCRIPTION_SERVICES=ws://localhost:5000 npm run dev
```

This is the recommended workflow for active development.

## CLI Tool

AriLink includes an optional CLI for managing the Docker stack:

```bash
# Install globally
npm install -g arilink

# Initialize a new project
mkdir my-callcenter && cd my-callcenter
arilink init

# Manage services
arilink start       # Build & start all services
arilink stop        # Stop services (keeps containers)
arilink down        # Stop & remove containers
arilink restart     # Restart all services
arilink status      # Check service health
arilink logs        # Tail logs (arilink logs parakeet)
arilink update      # Pull latest code + rebuild
arilink open        # Open dashboard in browser
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Network: arilink                        │
│                                                 │
│  ┌───────────┐  ┌───────────┐  ┌────────────┐  │
│  │ Asterisk  │  │ Parakeet  │  │  AriLink   │  │
│  │ :5060 SIP │  │ :5000 WS  │  │ :3011 HTTP │  │
│  │ :8088 ARI │  │           │  │ :8000 RTP  │  │
│  └───────────┘  └───────────┘  └────────────┘  │
│       │              │              │           │
│       └──── ARI ─────┘── WS ───────┘           │
│                                                 │
│  ┌────────────┐ (optional, --profile rust-rtp)  │
│  │ Rust RTP   │                                 │
│  │ :9900      │                                 │
│  └────────────┘                                 │
└─────────────────────────────────────────────────┘
```

- **Asterisk** receives SIP calls and sends RTP audio to AriLink
- **AriLink** connects to Asterisk via ARI, forwards audio to Parakeet for transcription
- **Parakeet** runs the AI model and streams transcription results back

## Volumes

| Mount | Purpose |
|-------|---------|
| `./data:/app/data` | SQLite call history database |
| `./logs:/app/logs` | Application log files |
| `parakeet-cache` | AI model downloads (persists across rebuilds) |

## Build Times

| What | First Build | Subsequent |
|------|-------------|------------|
| Asterisk | ~30s | Instant (cached) |
| AriLink | ~2 min | Instant (cached) |
| Parakeet | ~5-9 min | Instant (cached) |
| **Total** | **~8-12 min** | **~5s** |

First build downloads base images and installs all dependencies. Docker caches every layer, so subsequent builds only rebuild what changed.

## Troubleshooting

### Containers not starting

```bash
# Check container status
docker compose ps

# Check logs for a specific service
docker compose logs asterisk
docker compose logs arilink
docker compose logs parakeet
```

### Asterisk not connecting

Verify ARI is enabled:
```bash
docker compose exec asterisk asterisk -rx "ari show status"
```

### Transcription not working

Parakeet downloads the AI model on first run (~2GB). Check if it's still loading:
```bash
docker compose logs -f parakeet
```

### Port conflicts

If ports 5060, 3011, or 8088 are already in use, stop the conflicting service or change the port mapping in `docker-compose.yml`.

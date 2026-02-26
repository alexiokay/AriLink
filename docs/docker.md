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

That's it. Four services start automatically:

| Service | Port | Description |
|---------|------|-------------|
| **Dashboard** | [localhost:3011](http://localhost:3011) | Web UI + API + Socket.IO |
| **Asterisk** | localhost:5060 (SIP), localhost:8088 (ARI) | PBX with ARI enabled |
| **Parakeet** | localhost:5000 | AI speech-to-text (STT) |
| **Kokoro** | localhost:5001 | AI text-to-speech (TTS) |

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

This swaps Parakeet and Kokoro to CUDA-enabled images. STT goes from ~2x real-time (CPU) to ~2000x real-time (GPU). TTS also benefits significantly from GPU acceleration.

### Prerequisites

1. NVIDIA GPU with CUDA 12.x support
2. [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) installed on the host

## Rust RTP Server (Optional)

For echo cancellation (AEC3), Silero VAD barge-in detection, and high-performance audio handling:

```bash
docker compose --profile rust-rtp up -d
```

This starts an additional Rust-based RTP server with WebRTC-grade echo cancellation and neural speech detection. Add `USE_RUST_RTP=true` to `.env` to route audio through it (required when using `--profile rust-rtp`).

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
# Start only Asterisk + Parakeet + Kokoro
docker compose up -d asterisk parakeet kokoro

# Run the app locally with hot reload
PBX_IP=localhost TRANSCRIPTION_SERVICES=ws://localhost:5000 TTS_SERVICE=ws://localhost:5001 npm run dev
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
│  │ :5060 SIP │  │ :5000 STT │  │ :3011 HTTP │  │
│  │ :8088 ARI │  │           │  │ :8000 RTP  │  │
│  └───────────┘  └───────────┘  └────────────┘  │
│       │              │              │           │
│  ┌───────────┐       │              │           │
│  │  Kokoro   │       │              │           │
│  │ :5001 TTS │       │              │           │
│  └───────────┘       │              │           │
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
- **Parakeet** runs the STT model and streams transcription results back
- **Kokoro** runs the TTS model and synthesizes speech from text (used by OpenClaw and any brain that calls `speak()`)

## Volumes

| Mount | Purpose |
|-------|---------|
| `./data:/app/data` | SQLite call history database |
| `./logs:/app/logs` | Application log files |
| `parakeet-cache` | STT model downloads (persists across rebuilds) |
| `kokoro-cache` | TTS model downloads (persists across rebuilds) |

## Build Times

| What | First Build | Subsequent |
|------|-------------|------------|
| Asterisk | ~30s | Instant (cached) |
| AriLink | ~2 min | Instant (cached) |
| Parakeet | ~5-9 min | Instant (cached) |
| Kokoro | ~3-5 min | Instant (cached) |
| **Total** | **~11-17 min** | **~5s** |

First build downloads base images and installs all dependencies. Docker caches every layer, so subsequent builds only rebuild what changed.

## Container Management from Dashboard

When running in Docker, the dashboard can restart individual containers without SSH access. This is enabled automatically when the Docker socket is mounted.

### How It Works

The `arilink` container communicates with the Docker daemon via the mounted socket (`/var/run/docker.sock`). A hardcoded allowlist ensures only known sibling containers can be managed:

| Dashboard Service | Docker Container | Restart Delay |
|-------------------|-----------------|---------------|
| Transcription (Parakeet) | `arilink-parakeet` | 3s reconnect |
| TTS (Kokoro) | `arilink-kokoro` | 3s reconnect |
| Asterisk | `arilink-asterisk` | 5s reconnect |
| Rust RTP | `arilink-rust-rtp` | — |

### Dashboard UI

- **Home page**: Each service card shows a restart button (when Docker is available) alongside the existing reconnect button. Container state, health, and uptime are displayed below each card.
- **Config page**: The Transcription Engine card has a dedicated "Restart Container" button.

### REST API

Container management is also available via REST (useful for CLI tools or MCP):

```bash
# Get all container statuses
curl http://localhost:3011/api/docker/status

# Restart a specific container
curl -X POST http://localhost:3011/api/docker/restart \
  -H "Content-Type: application/json" \
  -d '{"service": "kokoro"}'
```

### Disabling

Set `DOCKER_MANAGEMENT=false` in your `.env` to disable container management even when the socket is mounted. When Docker is not available (local development), all container-related UI is hidden automatically.

### Security

- The socket is mounted **read-only** (`ro`) — only inspect and restart commands work
- Container names come from a hardcoded allowlist (never from user input)
- Commands use `execFile` (not `exec`) to prevent shell injection
- Only the Docker CLI binary is installed (~30MB), not the daemon

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

### Kokoro TTS not starting

First start downloads the model (~500MB). Check logs:
```bash
docker compose logs -f kokoro
```
The healthcheck has a 180-second start period to allow for model download.

### Port conflicts

If ports 5060, 3011, 5001, or 8088 are already in use, stop the conflicting service or change the port mapping in `docker-compose.yml`.

## Related

- [OpenClaw Integration](OPENCLAW-INTEGRATION.md) — Connect AriLink to OpenClaw AI agents
- [Assistant Architecture](ASSISTANT-ARCHITECTURE.md) — How assistants and brains work
- [Transcription Services](TRANSCRIPTION-SERVICES.md) — STT configuration

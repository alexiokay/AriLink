# Rust RTP Server

High-performance RTP audio server for AriLink. Receives RTP audio from Asterisk ExternalMedia channels, decodes it, and forwards to transcription services (e.g. Parakeet) via WebSocket.

## Building

### Using npm (recommended)

```bash
npm run build:rtp
```

This builds the binary and copies it to `bin/`. On Windows with Zig installed in `tools/`, it also cross-compiles a Linux binary.

### Using cargo directly

```bash
cd rust-rtp-server
cargo build --release
```

Binary output: `rust-rtp-server/target/release/ari-rtp-server(.exe)`

### CI/CD

Push changes to `rust-rtp-server/` on `main` to trigger the GitHub Actions workflow, which builds natively on Linux and Windows and commits binaries to `bin/`.

## Running

### Standalone

```bash
RTP_LISTEN_ADDR=0.0.0.0:8000 \
TRANSCRIPTION_SERVICES=ws://localhost:5000 \
API_PORT=9900 \
cargo run --release
```

### With Node.js (automatic)

Set `USE_RUST_RTP=true` in `.env` and the Node.js manager will start the Rust server automatically:

```bash
npm start
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RTP_LISTEN_ADDR` | `0.0.0.0:8000` | UDP address for incoming RTP packets |
| `API_PORT` | `9900` | HTTP/WebSocket API port |
| `DEFAULT_CODEC` | `slin16` | Audio codec (`ulaw`, `slin16`, `opus`) |
| `TRANSCRIPTION_SERVICES` | _(empty)_ | Comma-separated WebSocket URLs (e.g. `ws://localhost:5000`) |
| `BUFFER_FLUSH_MS` | `100` | Audio buffer flush interval in ms |

## API

### HTTP

- `GET /health` - Health check
- `POST /sessions` - Create a new audio session
- `DELETE /sessions/:id` - Delete a session

### WebSocket

- `ws://localhost:9900/ws` - Transcription events stream

Events are JSON objects:
```json
{
  "type": "transcription",
  "sessionId": "call-xxx",
  "text": "hello world",
  "is_final": true
}
```

## Features

- **Opus codec** (optional) - Enabled by default. Disable with `--no-default-features` for environments without C toolchain.
- **Codec support** - ulaw (G.711), slin16 (16-bit signed linear), opus
- **Multiple transcription backends** - First URL is primary, rest are fallbacks

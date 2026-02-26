# ─── Stage 1: Build ───
FROM rust:1.88-slim AS builder

WORKDIR /app

# Install build deps for audiopus (Opus codec via opusic-sys)
# cmake + g++ needed by opusic-sys to build Opus from source
# libssl-dev needed by ort (ONNX Runtime) for downloading binaries
RUN apt-get update && \
    apt-get install -y pkg-config libopus-dev cmake g++ libssl-dev && \
    rm -rf /var/lib/apt/lists/*

# Cache deps by building a dummy project first
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Build the real project
COPY src/ ./src/
RUN touch src/main.rs && cargo build --release

# Stage the Silero VAD model data for the runtime image.
# The silero-vad-rust crate bakes the cargo registry path into the binary
# via env!("CARGO_MANIFEST_DIR"), so we recreate the exact path at runtime.
RUN mkdir -p /app/silero_staging && \
    SILERO_DATA=$(find /usr/local/cargo/registry/src -type d -name "data" -path "*/silero_vad/*" | head -1) && \
    cp -r "$SILERO_DATA" /app/silero_staging/data && \
    echo "$SILERO_DATA" > /app/silero_staging/expected_path


# ─── Stage 2: Runtime ───
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libopus0 ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/ari-rtp-server /usr/local/bin/ari-rtp-server

# Download ONNX Runtime 1.22.0 shared library (required by ort with load-dynamic feature).
# silero-vad-rust enables ort's load-dynamic feature, so the binary uses dlopen at runtime.
RUN curl -sL https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/onnxruntime-linux-x64-1.22.0.tgz | \
    tar xz -C /tmp && \
    cp /tmp/onnxruntime-linux-x64-1.22.0/lib/libonnxruntime.so.1.22.0 /usr/local/lib/ && \
    ln -sf libonnxruntime.so.1.22.0 /usr/local/lib/libonnxruntime.so && \
    rm -rf /tmp/onnxruntime-linux-x64-1.22.0 && \
    ldconfig

# Install Silero VAD model data at the path the binary expects
COPY --from=builder /app/silero_staging /tmp/silero_staging
RUN EXPECTED_PATH=$(cat /tmp/silero_staging/expected_path) && \
    mkdir -p "$EXPECTED_PATH" && \
    cp -r /tmp/silero_staging/data/* "$EXPECTED_PATH/" && \
    rm -rf /tmp/silero_staging && \
    echo "Silero VAD model installed at: $EXPECTED_PATH"

ENV RUST_LOG=info

EXPOSE 9900 8000/udp 8001/udp

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD curl -sf http://127.0.0.1:9900/health || exit 1

CMD ["ari-rtp-server"]

# ─── Stage 1: Build ───
FROM rust:1.83-slim AS builder

WORKDIR /app

# Install build deps for audiopus (Opus codec)
RUN apt-get update && \
    apt-get install -y pkg-config libopus-dev && \
    rm -rf /var/lib/apt/lists/*

# Cache deps by building a dummy project first
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Build the real project
COPY src/ ./src/
RUN touch src/main.rs && cargo build --release


# ─── Stage 2: Runtime ───
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libopus0 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/ari-rtp-server /usr/local/bin/ari-rtp-server

ENV RUST_LOG=info

EXPOSE 9900

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD curl -sf http://127.0.0.1:9900/health || exit 1

CMD ["ari-rtp-server"]

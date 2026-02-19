# Parakeet TDT 0.6B-v3 Transcription Service
#
# Default: CPU mode (works on any machine)
# For GPU: use docker-compose.gpu.yml override

FROM python:3.10-slim

WORKDIR /app

# Install system deps for audio processing
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libsndfile1 \
      ffmpeg \
      build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .

# Install PyTorch CPU first, then the rest
RUN pip install --no-cache-dir \
      torch torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Copy service code
COPY server.py .
COPY main.py .

# Model cache persists via Docker volume
ENV TRANSCRIPTION_DEVICE=cpu
ENV PYTHONUNBUFFERED=1

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=120s \
  CMD python -c "import socket; s=socket.socket(); s.settimeout(5); s.connect(('127.0.0.1',5000)); s.close()" || exit 1

CMD python server.py --host 0.0.0.0 --port 5000 --device ${TRANSCRIPTION_DEVICE:-cpu}

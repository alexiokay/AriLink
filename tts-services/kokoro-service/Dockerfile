FROM python:3.10-slim

# espeak-ng is required by Kokoro for phoneme generation
RUN apt-get update && \
    apt-get install -y --no-install-recommends espeak-ng libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 5001

# Health check via TCP socket — model takes time to load on first start
HEALTHCHECK --interval=30s --timeout=10s --retries=5 --start-period=180s \
    CMD python -c "import socket; s=socket.socket(); s.settimeout(5); s.connect(('127.0.0.1',5001)); s.close()"

CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "5001"]

# 🎙️ Whisper Transcription Service

Local speech-to-text transcription service using Faster-Whisper and Whisper Large V3 Turbo.

## 🚀 Quick Start

### 1. Install UV (if not already installed)

```bash
# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# Linux/macOS
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. Create Virtual Environment and Install Dependencies

```bash
cd whisper-service

# Create venv and install dependencies
uv venv
uv pip install -e .
```

### 3. Activate Virtual Environment

```bash
# Windows
.venv\Scripts\activate

# Linux/macOS
source .venv/bin/activate
```

### 4. Start the Service

```bash
python server.py
```

**With options:**
```bash
# Use different model
python server.py --model large-v3

# Use GPU (if available)
python server.py --device cuda --compute-type float16

# Custom port
python server.py --port 5001
```

## 📊 Model Options

| Model | Size | Speed | Accuracy | Memory |
|-------|------|-------|----------|--------|
| `tiny` | 39M | Fastest | Low | ~1GB |
| `base` | 74M | Very Fast | Good | ~1GB |
| `small` | 244M | Fast | Better | ~2GB |
| `medium` | 769M | Moderate | Great | ~5GB |
| `large-v3` | 1.55B | Slow | Best | ~10GB |
| `large-v3-turbo` | 809M | **Fast** | **Best** | ~6GB |

**Recommended**: `large-v3-turbo` (default) - best balance of speed and accuracy

## 🔧 Configuration

### Environment Variables

Create `.env` file in whisper-service directory:

```env
WHISPER_MODEL=large-v3-turbo
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_HOST=0.0.0.0
WHISPER_PORT=5000
```

### Compute Types

- `int8` - **Recommended for CPU** (fastest, minimal accuracy loss)
- `float16` - Good for GPU
- `float32` - Highest accuracy, slowest

## 📡 WebSocket API

### Connect

```javascript
const ws = new WebSocket('ws://localhost:5000');
```

### Send Audio Data

Send raw PCM audio bytes:
- **Format**: PCM 16-bit signed integer
- **Sample Rate**: 16000 Hz (16kHz)
- **Channels**: 1 (mono)

```javascript
// Send audio chunk
ws.send(audioBuffer);
```

### Receive Transcriptions

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'transcription') {
    console.log('Text:', data.text);
    console.log('Is Final:', data.is_final);
    console.log('Segments:', data.segments);
  }
};
```

### Control Messages

```javascript
// Ping
ws.send(JSON.stringify({ type: 'ping' }));

// Flush remaining audio buffer
ws.send(JSON.stringify({ type: 'flush' }));
```

## 🧪 Testing

Test with a WAV file:

```python
import websockets
import asyncio
import wave

async def test():
    uri = "ws://localhost:5000"
    async with websockets.connect(uri) as websocket:
        # Load WAV file (16kHz, mono, 16-bit PCM)
        with wave.open("test.wav", "rb") as wav:
            audio_data = wav.readframes(wav.getnframes())

        # Send in chunks
        chunk_size = 32000  # 1 second of audio
        for i in range(0, len(audio_data), chunk_size):
            await websocket.send(audio_data[i:i+chunk_size])
            await asyncio.sleep(0.1)

        # Flush and get final result
        await websocket.send('{"type":"flush"}')

        # Receive results
        async for message in websocket:
            result = json.loads(message)
            print(f"Transcription: {result['text']}")

asyncio.run(test())
```

## 🔍 Troubleshooting

### Model Download Issues

Models are downloaded automatically on first run to:
- Windows: `C:\Users\<user>\.cache\huggingface\hub\`
- Linux/macOS: `~/.cache/huggingface/hub/`

### Performance Optimization

**For CPU (18 concurrent calls):**
```bash
# Use smaller model or int8 quantization
python server.py --model medium --compute-type int8

# OR run multiple instances on different ports
python server.py --port 5000 &
python server.py --port 5001 &
python server.py --port 5002 &
```

**For GPU:**
```bash
python server.py --device cuda --compute-type float16
```

### Memory Issues

If you get OOM errors, use a smaller model:
```bash
python server.py --model medium
# or
python server.py --model small
```

## 📈 Performance Benchmarks

Approximate transcription speed (RTF = Real-Time Factor):

| Model | CPU (int8) | GPU (float16) |
|-------|-----------|---------------|
| tiny | RTF 50x | RTF 200x |
| small | RTF 20x | RTF 100x |
| medium | RTF 10x | RTF 50x |
| large-v3-turbo | RTF 5x | RTF 30x |

**RTF 5x** = processes 5 seconds of audio in 1 second (more than enough for real-time)

## 🔗 Integration with AriLink

The Node.js server will connect to this service automatically. No additional configuration needed once the service is running.

## 📚 Resources

- [Faster-Whisper GitHub](https://github.com/SYSTRAN/faster-whisper)
- [OpenAI Whisper](https://github.com/openai/whisper)
- [UV Package Manager](https://github.com/astral-sh/uv)

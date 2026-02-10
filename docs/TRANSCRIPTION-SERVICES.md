# Transcription Services Guide

Choose between different transcription backends for your AriLink server.

## Available Services

### 1. **Parakeet TDT 0.6B-v3** (RECOMMENDED) ⭐

**Location:** `transcription-services/parakeet-service/`

**Features:**
- ✅ 25 languages (English, Polish, German, French, Spanish, etc.)
- ✅ Automatic language detection
- ✅ 64% faster than other 1.1B models
- ✅ Only ~1.5 GB VRAM
- ✅ 3000x+ real-time factor
- ✅ Best for call centers and telephony

**Start:**
```batch
cd transcription-services/parakeet-service
start-service.bat
```

**Runs on:** `ws://localhost:5000`

---

### 2. **Whisper** (Alternative)

**Location:** `transcription-services/whisper-service/`

**Features:**
- ✅ Multi-language support
- ✅ High accuracy
- ⚠️ Slower than Parakeet
- ⚠️ Higher VRAM usage

**Start:**
```batch
cd transcription-services/whisper-service
start-service.bat
```

**Runs on:** `ws://localhost:5000` (default) or configure different port

---

### 3. **Google Cloud Speech** (Cloud)

**Features:**
- ✅ Speaker diarization
- ✅ No local GPU needed
- ❌ Requires Google Cloud account
- ❌ API costs

**Setup:**
1. Add `google` to `TRANSCRIPTION_SERVICES` in `.env`:
   ```env
   # Google only
   TRANSCRIPTION_SERVICES=google

   # Or as fallback
   TRANSCRIPTION_SERVICES=ws://localhost:5000,google
   ```
2. Configure `GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json`

---

## Configuration

### `.env` file:

```env
# Simple: Use one service
TRANSCRIPTION_SERVICES=ws://localhost:5000

# With fallback: Try multiple services in order
TRANSCRIPTION_SERVICES=ws://localhost:5000,ws://localhost:5001,google
```

### Switching Services:

**Option 1: Use Parakeet Only (Recommended)**
1. Start: `cd transcription-services/parakeet-service && start-service.bat`
2. Set: `TRANSCRIPTION_SERVICES=ws://localhost:5000`

**Option 2: Use Whisper Only**
1. Start: `cd transcription-services/whisper-service && start-service.bat`
2. Set: `TRANSCRIPTION_SERVICES=ws://localhost:5000`

**Option 3: Use Parakeet with Whisper Fallback**
1. Start Parakeet on port 5000: `cd transcription-services/parakeet-service && start-service.bat`
2. Start Whisper on port 5001: Edit `transcription-services/whisper-service/start-service.bat` to use port 5001, then start it
3. Set: `TRANSCRIPTION_SERVICES=ws://localhost:5000,ws://localhost:5001`
4. If Parakeet fails, automatically switches to Whisper

**Option 4: Use Local with Google Cloud Fallback**
1. Start: `cd transcription-services/parakeet-service && start-service.bat`
2. Set: `TRANSCRIPTION_SERVICES=ws://localhost:5000,google`
3. Configure: `GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json`
4. If local service fails, automatically switches to Google Cloud

---

## Adding Custom Models

To add your own transcription model:

1. **Create service folder:**
   ```
   transcription-services/
     └── my-custom-service/
         ├── server.py
         ├── start-service.bat
         └── requirements.txt
   ```

2. **Implement WebSocket API:**
   - Accept binary audio data (16kHz, 16-bit PCM)
   - Return JSON: `{"type": "transcription", "text": "...", "is_final": true}`
   - Support ping/pong: `{"type": "ping"}` → `{"type": "pong"}`

3. **Configure:**
   ```env
   # Use custom service only
   TRANSCRIPTION_SERVICES=ws://localhost:YOUR_PORT

   # Or with fallback
   TRANSCRIPTION_SERVICES=ws://localhost:YOUR_PORT,ws://localhost:5000
   ```

---

## Comparison

| Feature | Parakeet TDT 0.6B | Whisper | Google Cloud |
|---------|-------------------|---------|--------------|
| **Languages** | 25 auto-detect | 90+ | 125+ |
| **Speed** | 3000x RTFx ⚡ | 100-500x | Varies |
| **VRAM** | ~1.5 GB 💚 | ~2-4 GB | None (cloud) |
| **Accuracy** | Excellent | Excellent | Excellent |
| **Cost** | Free 💰 | Free 💰 | Pay per use |
| **Offline** | ✅ Yes | ✅ Yes | ❌ No |
| **Best For** | Telephony, Call Centers | General purpose | Enterprise, No GPU |

---

## Troubleshooting

**Service won't start:**
- Check if port 5000 is already in use
- Ensure Python virtual environment is activated
- Check GPU availability with `nvidia-smi`

**No transcriptions:**
- Verify `TRANSCRIPTION_SERVICES` includes your running service URL
- Check service logs for errors
- Ensure audio format is `slin16`
- Check if fallback services are working if primary fails

**Slow transcriptions:**
- Parakeet is recommended for lowest latency
- Check GPU utilization
- Ensure CUDA is properly installed

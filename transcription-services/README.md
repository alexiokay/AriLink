# Transcription Services

This folder contains different transcription backend services that can be used with the ARI Stasi Server.

## Available Services

### 📁 parakeet-service/
**NVIDIA Parakeet TDT 0.6B-v3** - Fast multilingual transcription (RECOMMENDED)
- 25 languages including English, Polish, German, French, Spanish
- 3000x+ real-time factor (extremely fast)
- Only ~1.5 GB VRAM
- Best for telephony and call centers

**Start:** `cd parakeet-service && start-service.bat`
**URL:** `ws://localhost:5000`

### 📁 whisper-service/
**OpenAI Whisper** - High-accuracy alternative
- 90+ languages
- Slower than Parakeet but still fast
- ~2-4 GB VRAM

**Start:** `cd whisper-service && start-service.bat`
**URL:** `ws://localhost:5000`

## Usage

1. **Choose a service** and start it using the commands above
2. **Configure `.env`** in the root directory:
   ```env
   TRANSCRIPTION_SERVICES=ws://localhost:5000
   ```

   **With fallback:**
   ```env
   # Try Parakeet first, fallback to Whisper on port 5001
   TRANSCRIPTION_SERVICES=ws://localhost:5000,ws://localhost:5001

   # Try Parakeet first, fallback to Google Cloud
   TRANSCRIPTION_SERVICES=ws://localhost:5000,google
   ```
3. **Start your ARI server** from the root directory

## Adding Custom Services

To add your own transcription model:

1. Create a new folder: `transcription-services/my-service/`
2. Implement a WebSocket server that:
   - Accepts binary audio (16kHz, 16-bit PCM)
   - Returns JSON: `{"type": "transcription", "text": "...", "is_final": true}`
3. Update `.env` to point to your service URL

See the complete guide: [TRANSCRIPTION-SERVICES.md](../docs/TRANSCRIPTION-SERVICES.md)

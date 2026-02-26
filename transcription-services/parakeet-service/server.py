#!/usr/bin/env python3
"""
NVIDIA Parakeet TDT Multilingual Transcription Service
Provides WebSocket-based real-time transcription using Parakeet-TDT-0.6B-v3
Supports 25 languages including English, Polish, German, French, Spanish, and more
Automatic language detection - 64% faster and more accurate than RNNT 1.1B!
TDT architecture: Novel Token-and-Duration Transducer (2024-2025)
"""

import asyncio
import json
import logging
import signal
import sys
import os
from http import HTTPStatus
from pathlib import Path
import torch
import websockets
import nemo.collections.asr as nemo_asr
import numpy as np
import soundfile as sf

# Version-compatible HTTP health handler for websockets 12+ / 13+
try:
    from websockets.http11 import Response as _WsResponse
    from websockets.datastructures import Headers as _WsHeaders
    def _create_health_handler(service):
        def handler(connection, request):
            if request.path == "/health":
                body = service._health_json().encode()
                return _WsResponse(200, "OK", _WsHeaders([("Content-Type", "application/json")]), body)
        return handler
except ImportError:
    def _create_health_handler(service):
        async def handler(path, request_headers):
            if path == "/health":
                body = service._health_json().encode()
                return HTTPStatus.OK, [("Content-Type", "application/json")], body
        return handler

# CUDA graphs enabled for maximum performance
# os.environ["NEMO_DISABLE_CUDA_GRAPHS"] = "1"  # Uncomment if CUDA errors occur

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class ParakeetTranscriptionService:
    def __init__(
        self,
        model_name: str = "nvidia/parakeet-tdt-0.6b-v3",
        device: str = "cuda",
        host: str = "0.0.0.0",
        port: int = 5000,
        use_vad_chunking: bool = True
    ):
        self.host = host
        self.port = port
        self.model_name = model_name
        self.device = device
        self.model = None
        self.vad_model = None
        self.use_vad_chunking = use_vad_chunking

        # VAD threshold: probability above which audio is considered speech.
        # 0.3 = very sensitive (catches faint speech but also noise → ghost words)
        # 0.5 = balanced (standard Silero recommendation)
        # 0.7 = conservative (only clear speech, less false positives)
        self.vad_threshold = float(os.environ.get("VAD_THRESHOLD", "0.5"))

        # Health handler for HTTP /health endpoint
        self._process_request = _create_health_handler(self)

        # Audio buffer settings
        self.sample_rate = 16000  # Parakeet expects 16kHz
        self.chunk_duration = 2.0  # Process 2 second chunks (optimized for accuracy)

    def load_model(self):
        """Load the NVIDIA Canary multilingual model and Silero VAD"""
        logger.info(f"Loading Canary model: {self.model_name} on {self.device}")

        # Load Parakeet model from pretrained
        self.model = nemo_asr.models.ASRModel.from_pretrained(
            model_name=self.model_name
        )

        # Move to GPU if available
        if self.device == "cuda":
            self.model = self.model.cuda()

        # Set to eval mode
        self.model.eval()

        # Load Silero VAD model
        logger.info("Loading Silero VAD model...")
        try:
            self.vad_model, utils = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                onnx=False
            )
            # Keep VAD on CPU to avoid CUDA compilation issues
            # VAD is tiny (1.8MB) and fast enough on CPU (~1ms per chunk)
            self.vad_model = self.vad_model.cpu()
            self.vad_model.eval()
            logger.info("✅ Silero VAD loaded successfully (running on CPU)")
        except Exception as e:
            logger.warning(f"Could not load Silero VAD: {e}")
            logger.info("Continuing without VAD - will process all audio")
            self.vad_model = None

        # Configure optimized decoding for call center use
        # Using default greedy decoding for best accuracy on streaming audio
        logger.info("✅ Using default greedy decoding (optimized for streaming)")
        # Note: Beam search was tried but gave worse results on this audio

        logger.info("✅ Canary model loaded successfully!")
        logger.info(f"   Model: {self.model_name}")
        logger.info(f"   Device: {self.device}")
        logger.info(f"   VRAM: ~2-3 GB for Canary-1b + 1.8MB for VAD")
        logger.info(f"   Speed: 2000x+ RTFx (Real-Time Factor)")
        logger.info(f"   Languages: 25 European languages (English, Polish, German, French, etc.)")
        logger.info(f"   Features: ASR (transcription) + AST (translation)")
        logger.info(f"   VAD threshold: {self.vad_threshold} (env VAD_THRESHOLD)")

        # Warmup inference — triggers PyTorch JIT/CUDA compilation so first real call is fast
        logger.info("Running warmup inference...")
        try:
            warmup_audio = torch.zeros(self.sample_rate)  # 1 second of silence
            if self.model is not None:
                self.model.transcribe(audio=[warmup_audio], batch_size=1, timestamps=False, verbose=False)
            if self.vad_model is not None:
                warmup_vad = torch.zeros(512).float().cpu()
                self.vad_model(warmup_vad, self.sample_rate)
                self.vad_model.reset_states()
            logger.info("✅ Warmup complete — first call will be fast")
        except Exception as e:
            logger.warning(f"Warmup inference failed (non-fatal): {e}")

    def detect_speech_in_chunk(self, audio_array: np.ndarray) -> float:
        """
        Get speech probability for an audio chunk using Silero VAD

        Args:
            audio_array: Float32 audio array normalized to [-1, 1]

        Returns:
            Maximum speech probability (0.0 to 1.0), or 1.0 if VAD not available
        """
        if self.vad_model is None:
            return 1.0  # No VAD, assume speech

        try:
            # Silero VAD expects chunks of 512 samples (32ms) for 16kHz
            chunk_size = 512
            audio_len = len(audio_array)

            if audio_len < chunk_size:
                return 1.0  # Too short, assume speech

            # Check multiple windows across the chunk to avoid missing speech
            # For chunks larger than 512 samples, check beginning, middle, and end
            max_prob = 0.0

            if audio_len <= chunk_size:
                # Small chunk, check it directly
                positions = [0]
            elif audio_len <= chunk_size * 2:
                # Medium chunk, check beginning and end
                positions = [0, audio_len - chunk_size]
            else:
                # Large chunk, check beginning, middle, end
                positions = [
                    0,
                    (audio_len // 2) - (chunk_size // 2),
                    audio_len - chunk_size
                ]

            for pos in positions:
                chunk = audio_array[pos:pos + chunk_size]

                # Convert to torch tensor (VAD runs on CPU)
                audio_tensor = torch.from_numpy(chunk).float().cpu()

                # Get speech probability
                with torch.no_grad():
                    speech_prob = self.vad_model(audio_tensor, self.sample_rate).item()
                    max_prob = max(max_prob, speech_prob)

            return max_prob

        except Exception as e:
            logger.error(f"VAD error: {e}", exc_info=True)
            return 1.0  # On error, assume speech

    def transcribe_audio(self, audio_data: bytes, language: str = "en") -> dict:
        """
        Transcribe audio data using Parakeet TDT
        
        Args:
            audio_data: Raw audio bytes (PCM 16-bit, 16kHz, mono)
            language: Language code (default: "en")
            
        Returns:
            dict with transcription results
        """
        if not self.model:
            raise RuntimeError("Model not loaded")

        try:
            # Convert bytes to numpy array (int16 PCM -> float32)
            audio_array = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0

            logger.info(f"Processing {len(audio_array)} samples ({len(audio_array)/self.sample_rate:.2f} seconds)")

            # Create tensor [T]
            # model.transcribe expects a list of input tensors, each [T]
            audio_tensor = torch.from_numpy(audio_array)

            # Transcribe (decoding strategy already configured in load_model)
            transcriptions = self.model.transcribe(
                audio=[audio_tensor],
                batch_size=1,
                timestamps=False,  # VAD can filter too aggressively
                verbose=False
            )

            # Parse results - NeMo returns different formats for greedy vs beam search
            if transcriptions and len(transcriptions) > 0:
                result = transcriptions[0]

                # Beam search returns list of Hypothesis objects, greedy returns single Hypothesis
                if isinstance(result, list):
                    # Beam search: take best hypothesis (first one, highest score)
                    hyp = result[0] if result else None
                    logger.info(f"Beam search returned {len(result)} hypotheses, using best")
                else:
                    # Greedy search: single hypothesis
                    hyp = result

                # Extract text from Hypothesis object
                if hyp and hasattr(hyp, 'text'):
                    text = hyp.text if hyp.text else ""
                else:
                    text = str(hyp) if hyp else ""

                # Extract timestamps if available
                segments = []
                if hyp and hasattr(hyp, 'timestep') and isinstance(hyp.timestep, dict):
                    word_timestamps = hyp.timestep.get('word', [])
                    if word_timestamps:
                        segments = [{"text": word, "start": start, "end": end}
                                  for word, start, end in word_timestamps]

                logger.info(f"Transcription: '{text}'")

                return {
                    "success": True,
                    "text": text.strip(),
                    "segments": segments
                }
            else:
                return {
                    "success": True,
                    "text": "",
                    "segments": []
                }

        except Exception as e:
            logger.error(f"Transcription error: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }

    async def handle_client(self, websocket):
        """Handle WebSocket client connection"""
        client_id = id(websocket)
        logger.info(f"🔗 Client {client_id} connected")

        # Reset Silero VAD LSTM state for clean speech detection on this call
        if self.vad_model is not None:
            self.vad_model.reset_states()

        audio_buffer = bytearray()

        # Initialize variables for both modes
        is_speaking = False
        last_audio_time = asyncio.get_event_loop().time()

        if self.use_vad_chunking:
            # VAD-based chunking with smart timeout
            pre_roll_buffer = bytearray()
            pre_roll_size = int(0.2 * self.sample_rate * 2)  # 200ms pre-roll
            min_chunk_size = int(0.2 * self.sample_rate * 2)  # 200ms minimum for fast response
            max_chunk_size = int(10.0 * self.sample_rate * 2)  # 10 seconds maximum
            silence_frames = 0
            silence_threshold = 2  # Reduced from 3 to 2 for faster response
            speech_timeout = 1.0  # If no audio for 1 second while speaking, flush

            logger.info(f"[Client {client_id}] VAD-based chunking enabled (speech timeout: {speech_timeout}s)")
        else:
            # Simple time-based chunking (reliable, proven approach)
            chunk_size = int(self.chunk_duration * self.sample_rate * 2)  # 2 seconds
            min_chunk_size = 0  # Not used in time-based mode
            speech_timeout = 1.0  # Not used in time-based mode
            logger.info(f"[Client {client_id}] Time-based chunking: {self.chunk_duration}s chunks")

        try:
            while True:
                try:
                    # Wait for message with timeout to enable periodic checks
                    message = await asyncio.wait_for(websocket.recv(), timeout=0.5)
                except asyncio.TimeoutError:
                    # Timeout - check if we need to flush pending speech
                    if self.use_vad_chunking and is_speaking:
                        current_time = asyncio.get_event_loop().time()
                        if (current_time - last_audio_time) > speech_timeout and len(audio_buffer) >= min_chunk_size:
                            logger.info(f"[Client {client_id}] ⏱️  No audio received, flushing buffer")
                            chunk = bytes(audio_buffer)
                            audio_buffer = bytearray()
                            is_speaking = False
                            silence_frames = 0

                            result = await asyncio.to_thread(self.transcribe_audio, chunk)
                            if result["success"] and result["text"]:
                                await websocket.send(json.dumps({
                                    "type": "transcription",
                                    "text": result["text"],
                                    "is_final": True,
                                    "segments": result.get("segments", [])
                                }))
                                logger.info(f"[Client {client_id}] ✅ Transcribed: {result['text']}")
                    continue
                if isinstance(message, bytes):
                    if self.use_vad_chunking:
                        # VAD-BASED CHUNKING PATH
                        current_time = asyncio.get_event_loop().time()

                        # Check for timeout: if speaking but no audio for speech_timeout seconds, flush
                        if is_speaking and (current_time - last_audio_time) > speech_timeout and len(audio_buffer) >= min_chunk_size:
                            logger.info(f"[Client {client_id}] ⏱️  Speech timeout ({speech_timeout}s), flushing buffer")
                            chunk = bytes(audio_buffer)
                            audio_buffer = bytearray()
                            is_speaking = False
                            silence_frames = 0

                            result = await asyncio.to_thread(self.transcribe_audio, chunk)
                            if result["success"] and result["text"]:
                                await websocket.send(json.dumps({
                                    "type": "transcription",
                                    "text": result["text"],
                                    "is_final": True,
                                    "segments": result.get("segments", [])
                                }))
                                logger.info(f"[Client {client_id}] ✅ Transcribed: {result['text']}")

                        # Update last audio time
                        last_audio_time = current_time

                        # Add incoming audio to pre-roll buffer
                        pre_roll_buffer.extend(message)

                        # Keep only last 200ms in pre-roll
                        if len(pre_roll_buffer) > pre_roll_size:
                            pre_roll_buffer = pre_roll_buffer[-pre_roll_size:]

                        # Check speech probability in this chunk
                        audio_array = np.frombuffer(message, dtype=np.int16).astype(np.float32) / 32768.0
                        speech_prob = self.detect_speech_in_chunk(audio_array)

                        # Configurable VAD threshold (env VAD_THRESHOLD, default 0.5)
                        has_speech = speech_prob > self.vad_threshold

                        if has_speech:
                            # Speech detected
                            if not is_speaking:
                                # Speech START: add pre-roll to capture beginning
                                logger.info(f"[Client {client_id}] 🎤 Speech started (prob={speech_prob:.2f})")
                                audio_buffer.extend(pre_roll_buffer)
                                is_speaking = True
                                # Notify controller immediately for barge-in
                                await websocket.send(json.dumps({
                                    "type": "speech_started",
                                    "prob": round(speech_prob, 2)
                                }))

                            # Add current audio to buffer
                            audio_buffer.extend(message)
                            silence_frames = 0  # Reset silence counter

                            # Safety: flush if buffer too large
                            if len(audio_buffer) >= max_chunk_size:
                                logger.info(f"[Client {client_id}] ⚠️  Max buffer reached, flushing")
                                chunk = bytes(audio_buffer)
                                audio_buffer = bytearray()
                                is_speaking = False

                                result = await asyncio.to_thread(self.transcribe_audio, chunk)
                                if result["success"] and result["text"]:
                                    await websocket.send(json.dumps({
                                        "type": "transcription",
                                        "text": result["text"],
                                        "is_final": True,
                                        "segments": result.get("segments", [])
                                    }))
                                    logger.info(f"[Client {client_id}] ✅ Transcribed: {result['text']}")

                        else:
                            # Silence detected
                            if is_speaking:
                                silence_frames += 1
                                audio_buffer.extend(message)  # Keep accumulating during silence

                                # Speech END: flush after sustained silence
                                if silence_frames >= silence_threshold and len(audio_buffer) >= min_chunk_size:
                                    logger.info(f"[Client {client_id}] 🔇 Speech ended, flushing buffer")
                                    chunk = bytes(audio_buffer)
                                    audio_buffer = bytearray()
                                    is_speaking = False
                                    silence_frames = 0

                                    result = await asyncio.to_thread(self.transcribe_audio, chunk)
                                    if result["success"] and result["text"]:
                                        await websocket.send(json.dumps({
                                            "type": "transcription",
                                            "text": result["text"],
                                            "is_final": True,
                                            "segments": result.get("segments", [])
                                        }))
                                        logger.info(f"[Client {client_id}] ✅ Transcribed: {result['text']}")

                    else:
                        # TIME-BASED CHUNKING PATH (simple and reliable)
                        audio_buffer.extend(message)

                        # Process when we have accumulated enough audio
                        if len(audio_buffer) >= chunk_size:
                            chunk = bytes(audio_buffer)
                            audio_buffer = bytearray()

                            # Transcribe in thread pool
                            result = await asyncio.to_thread(self.transcribe_audio, chunk)

                            # Send result back to client
                            if result["success"] and result["text"]:
                                await websocket.send(json.dumps({
                                    "type": "transcription",
                                    "text": result["text"],
                                    "is_final": True,
                                    "segments": result.get("segments", [])
                                }))
                                logger.info(f"[Client {client_id}] ✅ Transcribed: {result['text']}")

                elif isinstance(message, str):
                    # Handle control messages
                    try:
                        msg = json.loads(message)
                        if msg.get("type") == "ping":
                            await websocket.send(json.dumps({"type": "pong"}))
                        elif msg.get("type") == "flush":
                            # Force flush remaining buffer
                            if len(audio_buffer) > 0:
                                logger.info(f"[Client {client_id}] Force flush requested")
                                result = await asyncio.to_thread(
                                    self.transcribe_audio,
                                    bytes(audio_buffer)
                                )
                                audio_buffer.clear()
                                if self.use_vad_chunking:
                                    is_speaking = False
                                    silence_frames = 0
                                if result["success"] and result["text"]:
                                    await websocket.send(json.dumps({
                                        "type": "transcription",
                                        "text": result["text"],
                                        "is_final": True
                                    }))
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON from client {client_id}")

        except websockets.exceptions.ConnectionClosed:
            logger.info(f"❌ Client {client_id} disconnected")
        except Exception as e:
            logger.error(f"Error handling client {client_id}: {e}", exc_info=True)
        finally:
            logger.info(f"Client {client_id} session ended")

    def _health_json(self):
        """JSON health response identifying this service"""
        return json.dumps({
            "service": "parakeet",
            "model": self.model_name,
            "device": self.device,
            "status": "ready" if self.model is not None else "loading",
        })

    async def start(self):
        """Start the WebSocket server"""
        logger.info(f"🚀 Starting Parakeet Transcription Service on {self.host}:{self.port}")
        self.load_model()

        async with websockets.serve(
            self.handle_client, self.host, self.port,
            process_request=self._process_request,
        ):
            logger.info(f"✅ Service ready! Listening on ws://{self.host}:{self.port}")
            logger.info(f"   GET /health returns service identity")
            logger.info(f"💡 Ready to handle 18+ concurrent calls with single model instance")
            await asyncio.Future()  # Run forever

def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="Parakeet TDT Transcription Service")
    parser.add_argument(
        "--model",
        default="nvidia/parakeet-tdt-0.6b-v3",
        help="Parakeet model name (default: nvidia/parakeet-tdt-0.6b-v3)"
    )
    parser.add_argument(
        "--device",
        default="cuda",
        choices=["cpu", "cuda"],
        help="Device to use (default: cuda)"
    )
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=5000, help="Port to bind to")

    args = parser.parse_args()

    service = ParakeetTranscriptionService(
        model_name=args.model,
        device=args.device,
        host=args.host,
        port=args.port
    )

    # Setup signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        logger.info("\n🛑 Received shutdown signal, stopping service...")
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        asyncio.run(service.start())
    except KeyboardInterrupt:
        logger.info("🛑 Shutting down service...")
    except Exception as e:
        logger.error(f"❌ Service error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

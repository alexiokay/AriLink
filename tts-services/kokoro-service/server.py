#!/usr/bin/env python3
"""
Kokoro TTS Service for AriLink
WebSocket-based text-to-speech using Kokoro 82M model.
Accepts JSON text requests, streams slin16 PCM audio back.

Protocol:
  Client sends:  {"sessionId": "abc", "text": "Hello", "voice": "af_heart", "speed": 1.0}
  Server sends:  binary slin16 PCM chunks (16kHz, 16-bit signed, little-endian)
  Server sends:  {"type": "tts_done", "sessionId": "abc"}

Also supports HTTP health check on /health (GET).
"""

import argparse
import asyncio
import json
import logging
import signal
import struct
import sys
import os
from pathlib import Path

import numpy as np
import websockets

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Kokoro outputs 24kHz, Asterisk needs 16kHz
KOKORO_SAMPLE_RATE = 24000
TARGET_SAMPLE_RATE = 16000


def resample_24k_to_16k(audio: np.ndarray) -> np.ndarray:
    """Resample 24kHz float32 audio to 16kHz using linear interpolation.
    Avoids heavy librosa dependency for this simple ratio (2:3)."""
    if len(audio) == 0:
        return audio
    ratio = TARGET_SAMPLE_RATE / KOKORO_SAMPLE_RATE  # 0.6667
    new_length = int(len(audio) * ratio)
    indices = np.linspace(0, len(audio) - 1, new_length)
    return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)


def float32_to_slin16(audio: np.ndarray) -> bytes:
    """Convert float32 [-1, 1] audio to signed 16-bit little-endian PCM bytes."""
    # Clip to prevent overflow
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767).astype(np.int16)
    return pcm.tobytes()


class KokoroTTSService:
    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 5001,
        default_voice: str = "af_heart",
        default_speed: float = 1.0,
        lang_code: str = "a",
    ):
        self.host = host
        self.port = port
        self.default_voice = default_voice
        self.default_speed = default_speed
        self.lang_code = lang_code
        self.pipeline = None
        self._active_sessions = 0

    def load_model(self):
        """Load Kokoro TTS model."""
        logger.info("Loading Kokoro TTS model...")
        try:
            from kokoro import KPipeline

            self.pipeline = KPipeline(lang_code=self.lang_code)
            logger.info(
                f"Kokoro model loaded (lang={self.lang_code}, "
                f"default_voice={self.default_voice})"
            )

            # Warm up with a short synthesis
            logger.info("Warming up model...")
            for _gs, _ps, _audio in self.pipeline(
                "Hello.", voice=self.default_voice, speed=1.0
            ):
                pass
            logger.info("Model warm-up complete")

        except ImportError:
            logger.error(
                "kokoro package not installed. Run: pip install kokoro>=0.9.4"
            )
            sys.exit(1)

    async def handle_client(self, websocket):
        """Handle a single WebSocket client connection."""
        client_id = id(websocket)
        logger.info(f"Client {client_id} connected")

        try:
            async for message in websocket:
                # Only accept text (JSON) messages
                if isinstance(message, bytes):
                    logger.warning(f"Client {client_id}: unexpected binary message")
                    continue

                try:
                    request = json.loads(message)
                except json.JSONDecodeError:
                    await websocket.send(
                        json.dumps({"type": "error", "error": "Invalid JSON"})
                    )
                    continue

                session_id = request.get("sessionId", "unknown")
                text = request.get("text", "").strip()
                voice = request.get("voice", self.default_voice)
                speed = request.get("speed", self.default_speed)

                if not text:
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "error",
                                "sessionId": session_id,
                                "error": "Empty text",
                            }
                        )
                    )
                    continue

                logger.info(
                    f"[{session_id}] TTS request: voice={voice} speed={speed} "
                    f'text="{text[:80]}{"..." if len(text) > 80 else ""}"'
                )

                self._active_sessions += 1
                try:
                    await self._synthesize_and_stream(
                        websocket, session_id, text, voice, speed
                    )
                except Exception as e:
                    logger.error(f"[{session_id}] Synthesis error: {e}")
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "error",
                                "sessionId": session_id,
                                "error": str(e),
                            }
                        )
                    )
                finally:
                    self._active_sessions -= 1

        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client {client_id} disconnected")
        except Exception as e:
            logger.error(f"Client {client_id} error: {e}")

    async def _synthesize_and_stream(
        self,
        websocket,
        session_id: str,
        text: str,
        voice: str,
        speed: float,
    ):
        """Run Kokoro synthesis and stream slin16 audio chunks."""
        if not self.pipeline:
            raise RuntimeError("Model not loaded")

        total_samples = 0
        chunk_count = 0

        # Run blocking synthesis in thread pool to avoid blocking the event loop
        loop = asyncio.get_event_loop()

        def _generate():
            """Generator wrapper that runs in a thread."""
            return list(self.pipeline(text, voice=voice, speed=speed))

        chunks = await loop.run_in_executor(None, _generate)

        for _gs, _ps, audio in chunks:
            if audio is None or len(audio) == 0:
                continue

            # Resample 24kHz → 16kHz
            audio_16k = resample_24k_to_16k(audio)

            # Convert to slin16 bytes
            pcm_bytes = float32_to_slin16(audio_16k)

            # Send binary audio chunk
            await websocket.send(pcm_bytes)

            total_samples += len(audio_16k)
            chunk_count += 1

        # Send completion message
        duration_ms = int(total_samples / TARGET_SAMPLE_RATE * 1000)
        await websocket.send(
            json.dumps(
                {
                    "type": "tts_done",
                    "sessionId": session_id,
                    "chunks": chunk_count,
                    "durationMs": duration_ms,
                }
            )
        )

        logger.info(
            f"[{session_id}] Done: {chunk_count} chunks, "
            f"{duration_ms}ms audio, {total_samples} samples"
        )

    async def start(self):
        """Start the WebSocket server."""
        logger.info(f"Starting Kokoro TTS service on ws://{self.host}:{self.port}")

        stop_event = asyncio.Event()

        def _signal_handler():
            logger.info("Shutdown signal received")
            stop_event.set()

        loop = asyncio.get_event_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, _signal_handler)
            except NotImplementedError:
                # Windows doesn't support add_signal_handler
                signal.signal(sig, lambda s, f: _signal_handler())

        async with websockets.serve(
            self.handle_client,
            self.host,
            self.port,
            max_size=1024 * 1024,  # 1MB max message
            ping_interval=30,
            ping_timeout=10,
        ):
            logger.info(f"Kokoro TTS service ready on ws://{self.host}:{self.port}")
            await stop_event.wait()

        logger.info("Kokoro TTS service stopped")


def main():
    parser = argparse.ArgumentParser(description="Kokoro TTS Service for AriLink")
    parser.add_argument("--host", default="0.0.0.0", help="Listen host")
    parser.add_argument("--port", type=int, default=5001, help="Listen port")
    parser.add_argument(
        "--voice",
        default=os.environ.get("TTS_VOICE", "af_heart"),
        help="Default voice (e.g., af_heart, af_bella, am_adam)",
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=float(os.environ.get("TTS_SPEED", "1.0")),
        help="Default speech speed",
    )
    parser.add_argument(
        "--lang",
        default=os.environ.get("TTS_LANG", "a"),
        help="Language code: a=American English, b=British, e=Spanish, f=French",
    )
    args = parser.parse_args()

    service = KokoroTTSService(
        host=args.host,
        port=args.port,
        default_voice=args.voice,
        default_speed=args.speed,
        lang_code=args.lang,
    )

    service.load_model()
    asyncio.run(service.start())


if __name__ == "__main__":
    main()

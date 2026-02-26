#!/usr/bin/env python3
"""
Faster-Whisper Transcription Service
Provides WebSocket-based real-time transcription using Whisper Large V3 Turbo
"""

import asyncio
import json
import logging
import wave
import io
import signal
import sys
from http import HTTPStatus
from pathlib import Path
from typing import Optional

import websockets
from faster_whisper import WhisperModel
import numpy as np

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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class WhisperTranscriptionService:
    def __init__(
        self,
        model_size: str = "large-v3-turbo",
        device: str = "cpu",
        compute_type: str = "int8",
        host: str = "0.0.0.0",
        port: int = 5000
    ):
        self.host = host
        self.port = port
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.model: Optional[WhisperModel] = None

        # Health handler for HTTP /health endpoint
        self._process_request = _create_health_handler(self)

        # Audio buffer settings
        self.sample_rate = 16000  # Whisper expects 16kHz
        self.chunk_duration = 2.0  # Process 2 second chunks

    def load_model(self):
        """Load the Whisper model"""
        logger.info(f"Loading Whisper model: {self.model_size} on {self.device} with {self.compute_type}")
        self.model = WhisperModel(
            self.model_size,
            device=self.device,
            compute_type=self.compute_type
        )
        logger.info("Model loaded successfully!")

    def transcribe_audio(self, audio_data: bytes, language: str = "en") -> dict:
        """
        Transcribe audio data using Faster-Whisper

        Args:
            audio_data: Raw audio bytes (PCM 16-bit, 16kHz, mono)
            language: Language code (default: "en")

        Returns:
            dict with transcription results
        """
        if not self.model:
            raise RuntimeError("Model not loaded")

        try:
            # Convert bytes to numpy array
            audio_array = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0

            logger.info(f"Transcribing {len(audio_array)} samples ({len(audio_array)/self.sample_rate:.2f} seconds)")

            # Transcribe
            segments, info = self.model.transcribe(
                audio_array,
                language=language,
                beam_size=5,
                vad_filter=True,  # Voice Activity Detection
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    threshold=0.5
                )
            )

            # Collect all segments
            transcription_text = ""
            segments_list = []

            for segment in segments:
                transcription_text += segment.text + " "
                segments_list.append({
                    "start": segment.start,
                    "end": segment.end,
                    "text": segment.text.strip()
                })

            return {
                "success": True,
                "text": transcription_text.strip(),
                "segments": segments_list,
                "language": info.language,
                "language_probability": info.language_probability
            }

        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def handle_client(self, websocket):
        """Handle WebSocket client connection"""
        client_id = id(websocket)
        logger.info(f"Client {client_id} connected")

        audio_buffer = bytearray()

        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    # Accumulate audio data
                    audio_buffer.extend(message)

                    # Process when we have enough data (2 seconds at 16kHz, 16-bit)
                    chunk_size = int(self.chunk_duration * self.sample_rate * 2)  # 2 bytes per sample

                    if len(audio_buffer) >= chunk_size:
                        # Extract chunk for processing
                        chunk = bytes(audio_buffer[:chunk_size])
                        audio_buffer = audio_buffer[chunk_size:]

                        # Transcribe in thread pool (blocking operation)
                        result = await asyncio.to_thread(
                            self.transcribe_audio,
                            chunk
                        )

                        # Send result back to client
                        if result["success"] and result["text"]:
                            await websocket.send(json.dumps({
                                "type": "transcription",
                                "text": result["text"],
                                "is_final": True,
                                "segments": result["segments"]
                            }))
                            logger.info(f"[Client {client_id}] ✅ Transcribed: {result['text']}")

                elif isinstance(message, str):
                    # Handle control messages
                    try:
                        msg = json.loads(message)
                        if msg.get("type") == "ping":
                            await websocket.send(json.dumps({"type": "pong"}))
                        elif msg.get("type") == "flush":
                            # Process remaining buffer
                            if len(audio_buffer) > 0:
                                result = await asyncio.to_thread(
                                    self.transcribe_audio_sync,
                                    bytes(audio_buffer)
                                )
                                audio_buffer.clear()
                                if result["success"] and result["text"]:
                                    await websocket.send(json.dumps({
                                        "type": "transcription",
                                        "text": result["text"],
                                        "is_final": True
                                    }))
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON from client {client_id}")

        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client {client_id} disconnected")
        except Exception as e:
            logger.error(f"Error handling client {client_id}: {e}")
        finally:
            logger.info(f"Client {client_id} session ended")

    def transcribe_audio_sync(self, audio_data: bytes, language: str = "en") -> dict:
        """Synchronous wrapper for transcription (for thread pool)"""
        return asyncio.run(self.transcribe_audio(audio_data, language))

    def _health_json(self):
        """JSON health response identifying this service"""
        return json.dumps({
            "service": "whisper",
            "model": self.model_size,
            "device": self.device,
            "compute_type": self.compute_type,
            "status": "ready" if self.model is not None else "loading",
        })

    async def start(self):
        """Start the WebSocket server"""
        logger.info(f"Starting Whisper Transcription Service on {self.host}:{self.port}")
        self.load_model()

        async with websockets.serve(
            self.handle_client, self.host, self.port,
            process_request=self._process_request,
        ):
            logger.info(f"✅ Service ready! Listening on ws://{self.host}:{self.port}")
            logger.info(f"   GET /health returns service identity")
            await asyncio.Future()  # Run forever

def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="Whisper Transcription Service")
    parser.add_argument("--model", default="large-v3-turbo", help="Whisper model size")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="Device to use")
    parser.add_argument("--compute-type", default="int8", help="Compute type (int8, float16, float32)")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=5000, help="Port to bind to")

    args = parser.parse_args()

    service = WhisperTranscriptionService(
        model_size=args.model,
        device=args.device,
        compute_type=args.compute_type,
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

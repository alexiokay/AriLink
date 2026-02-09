@echo off
echo Starting Whisper Transcription Service...
echo.
echo Configuration:
echo    Model: large-v3-turbo
echo    Device: GPU (CUDA) with float16
echo    Port: 5000
echo    Host: 0.0.0.0
echo.
echo Speed: 10-30x faster than CPU!
echo.

.venv\Scripts\python.exe server.py --model large-v3-turbo --device cuda --compute-type float16

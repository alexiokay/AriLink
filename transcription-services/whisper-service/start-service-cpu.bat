@echo off
echo Starting Whisper Transcription Service (CPU Mode)...
echo.
echo Configuration:
echo    Model: large-v3-turbo
echo    Device: CPU (int8)
echo    Port: 5000
echo    Host: 0.0.0.0
echo.
echo Note: This is slower. Use start-service.bat for GPU acceleration (10-30x faster)
echo.

.venv\Scripts\python.exe server.py --model large-v3-turbo --device cpu --compute-type int8

@echo off
echo ============================================================
echo   Parakeet TDT Transcription Service (CPU Mode)
echo   NVIDIA Parakeet TDT 0.6B v3
echo ============================================================
echo.
echo Configuration:
echo    Model: nvidia/parakeet-tdt-0.6b-v3
echo    Device: CPU
echo    Port: 5000
echo    Host: 0.0.0.0
echo.
echo Note: CPU mode is slower. Use start-service.bat for GPU (2000x faster)
echo.

.venv\Scripts\python.exe server.py --model nvidia/parakeet-tdt-0.6b-v3 --device cpu

echo.
echo Service stopped.
pause

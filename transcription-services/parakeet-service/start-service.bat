@echo off
echo ============================================================
echo   NVIDIA Parakeet TDT Multilingual Transcription Service
echo   Parakeet-TDT-0.6B-v3 (25 Languages, 64%% FASTER than 1.1B!)
echo ============================================================
echo.
echo Configuration:
echo    Model: nvidia/parakeet-tdt-0.6b-v3
echo    Device: GPU (CUDA)
echo    Port: 5000
echo    Host: 0.0.0.0
echo.
echo Performance:
echo    VRAM: ~1.5 GB (50%% less than RNNT 1.1B!)
echo    Speed: 3000x+ RTFx (64%% faster than RNNT 1.1B!)
echo    Accuracy: BETTER than RNNT 1.1B despite smaller size
echo    Languages: 25 (English, Polish, German, French, Spanish, etc.)
echo    Capacity: 25+ concurrent calls with single instance
echo.
echo Starting service...
echo.

.venv\Scripts\python.exe server.py --model nvidia/parakeet-tdt-0.6b-v3 --device cuda

echo.
echo Service stopped.
pause

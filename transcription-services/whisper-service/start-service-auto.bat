@echo off
echo Starting Whisper Transcription Service (Auto-detect mode)...
echo.

REM Check if CUDA is available
.venv\Scripts\python.exe -c "import ctranslate2; exit(0 if ctranslate2.get_cuda_device_count() > 0 else 1)" 2>nul

if %ERRORLEVEL% == 0 (
    echo CUDA detected! Using GPU acceleration...
    echo    Device: CUDA
    echo    Compute type: float16
    echo    Speed: 10-30x faster
    echo.
    .venv\Scripts\python.exe server.py --model large-v3-turbo --device cuda --compute-type float16
) else (
    echo No CUDA detected. Using CPU mode...
    echo    Device: CPU
    echo    Compute type: int8
    echo    Note: This is slower. Install CUDA for 10-30x speedup.
    echo.
    .venv\Scripts\python.exe server.py --model large-v3-turbo --device cpu --compute-type int8
)

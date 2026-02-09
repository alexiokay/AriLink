@echo off
echo Starting Parakeet Transcription Service (Auto-detect mode)...
echo.

REM Check if CUDA is available
.venv\Scripts\python.exe -c "import torch; exit(0 if torch.cuda.is_available() else 1)" 2>nul

if %ERRORLEVEL% == 0 (
    echo CUDA detected! Using GPU acceleration...
    echo    Device: CUDA
    echo    Speed: 2000x+ faster
    echo.
    .venv\Scripts\python.exe server.py --model nvidia/parakeet-tdt-0.6b-v3 --device cuda
) else (
    echo No CUDA detected. Using CPU mode...
    echo    Device: CPU
    echo    Note: This is slower. Install CUDA for 2000x speedup.
    echo.
    .venv\Scripts\python.exe server.py --model nvidia/parakeet-tdt-0.6b-v3 --device cpu
)

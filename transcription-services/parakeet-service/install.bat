@echo off
echo ============================================================
echo   Installing Parakeet TDT Dependencies (using UV)
echo ============================================================
echo.
echo This will install:
echo   - NVIDIA NeMo Toolkit (with ASR support)
echo   - PyTorch with CUDA support
echo   - Audio processing libraries
echo.
echo Using UV for ultra-fast installation (10x faster than pip!)
echo Installation may take 2-5 minutes...
echo.
pause

echo.
echo [1/4] Creating UV virtual environment...
uv venv .venv

echo.
echo [2/4] Activating virtual environment...
call .venv\Scripts\activate.bat

echo.
echo [3/4] Installing PyTorch with CUDA 12.x support...
uv pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

echo.
echo [4/4] Installing NeMo and dependencies...
uv pip install -r requirements.txt

echo.
echo ============================================================
echo   Installation Complete!
echo ============================================================
echo.
echo Next steps:
echo   1. Run check-gpu.bat to verify CUDA setup
echo   2. Run start-service.bat to start the service
echo.
pause

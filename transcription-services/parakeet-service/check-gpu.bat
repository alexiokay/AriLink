@echo off
echo Checking GPU/CUDA availability for Parakeet TDT...
echo.

.venv\Scripts\python.exe -c "import torch; import nemo; print('PyTorch version:', torch.__version__); print('CUDA available:', torch.cuda.is_available()); print('CUDA device count:', torch.cuda.device_count()); print('CUDA device name:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A'); print('NeMo version:', nemo.__version__)"

echo.
echo.
echo If CUDA device count = 0, you have two options:
echo   1. Install CUDA Toolkit from NVIDIA (requires NVIDIA GPU)
echo   2. Use CPU mode (slower but works without GPU)
echo.
pause

@echo off
echo Checking GPU/CUDA availability for Faster-Whisper...
echo.

.venv\Scripts\python.exe -c "from faster_whisper import WhisperModel; import ctranslate2; print('CTranslate2 version:', ctranslate2.__version__); print('CUDA available:', ctranslate2.get_cuda_device_count() > 0); print('CUDA device count:', ctranslate2.get_cuda_device_count()); print('Supported compute types (CPU):', ctranslate2.get_supported_compute_types('cpu')); print('Supported compute types (CUDA):', ctranslate2.get_supported_compute_types('cuda') if ctranslate2.get_cuda_device_count() > 0 else 'CUDA not available')"

echo.
echo.
echo If CUDA device count = 0, you have two options:
echo   1. Install CUDA Toolkit from NVIDIA (requires NVIDIA GPU)
echo   2. Use CPU mode (slower but works without GPU)
echo.
pause

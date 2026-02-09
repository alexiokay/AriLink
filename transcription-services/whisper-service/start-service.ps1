# Quick start script for Whisper service

Write-Host "Starting Whisper Transcription Service..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "   Model: large-v3-turbo" -ForegroundColor Gray
Write-Host "   Device: CPU (int8)" -ForegroundColor Gray
Write-Host "   Port: 5000" -ForegroundColor Gray
Write-Host "   Host: 0.0.0.0" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: First run will download the model (~800MB)" -ForegroundColor Yellow
Write-Host ""

& .venv/Scripts/python.exe server.py --model large-v3-turbo --device cpu --compute-type int8

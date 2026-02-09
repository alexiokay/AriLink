# PowerShell run script

Write-Host "🎙️ Starting Whisper Transcription Service..." -ForegroundColor Cyan

# Activate virtual environment
& .venv\Scripts\Activate.ps1

# Run the server
python server.py

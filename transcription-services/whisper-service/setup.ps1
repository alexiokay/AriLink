# PowerShell setup script for Whisper Transcription Service

Write-Host "🎙️ Setting up Whisper Transcription Service..." -ForegroundColor Cyan

# Check if UV is installed
if (!(Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "❌ UV is not installed. Installing UV..." -ForegroundColor Yellow
    irm https://astral.sh/uv/install.ps1 | iex
    Write-Host "✅ UV installed!" -ForegroundColor Green
} else {
    Write-Host "✅ UV already installed" -ForegroundColor Green
}

# Create virtual environment
Write-Host "📦 Creating virtual environment..." -ForegroundColor Cyan
uv venv

# Install dependencies
Write-Host "📥 Installing dependencies..." -ForegroundColor Cyan
uv pip install -r requirements.txt

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the service:" -ForegroundColor Cyan
Write-Host "  1. Activate the environment:"
Write-Host "     .venv\Scripts\Activate.ps1"
Write-Host "  2. Run the server:"
Write-Host "     python server.py"
Write-Host ""
Write-Host "Or use the run script:"
Write-Host "  .\run.ps1"

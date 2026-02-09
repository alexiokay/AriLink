#!/bin/bash
# Setup script for Whisper Transcription Service

echo "🎙️ Setting up Whisper Transcription Service..."

# Check if UV is installed
if ! command -v uv &> /dev/null; then
    echo "❌ UV is not installed. Installing UV..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    echo "✅ UV installed!"
else
    echo "✅ UV already installed"
fi

# Create virtual environment
echo "📦 Creating virtual environment..."
uv venv

# Activate and install dependencies
echo "📥 Installing dependencies..."
source .venv/bin/activate
uv pip install -r requirements.txt

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the service:"
echo "  1. Activate the environment:"
echo "     source .venv/bin/activate"
echo "  2. Run the server:"
echo "     python server.py"
echo ""
echo "Or use the run script:"
echo "  ./run.sh"

#!/bin/bash
# Quick launcher for K8sQuest

cd "$(dirname "$0")"

# Resolve the Python interpreter to use, in priority order:
_find_python() {
  if [ -n "$CONDA_PREFIX" ]; then
    if   [ -f "$CONDA_PREFIX/bin/python3" ]; then echo "$CONDA_PREFIX/bin/python3"; return
    elif [ -f "$CONDA_PREFIX/bin/python"  ]; then echo "$CONDA_PREFIX/bin/python";  return
    fi
  fi
  if [ -n "$VIRTUAL_ENV" ]; then
    if   [ -f "$VIRTUAL_ENV/bin/python3"       ]; then echo "$VIRTUAL_ENV/bin/python3";       return
    elif [ -f "$VIRTUAL_ENV/Scripts/python.exe" ]; then echo "$VIRTUAL_ENV/Scripts/python.exe"; return
    fi
  fi
  if   [ -f "venv/bin/python3"       ]; then echo "venv/bin/python3";       return
  elif [ -f "venv/Scripts/python.exe" ]; then echo "venv/Scripts/python.exe"; return
  fi
}

PYTHON=$(_find_python)
if [ -z "$PYTHON" ]; then
  echo "❌ No Python environment found. Please run ./install.sh first"
  echo "   Supported: conda env, virtualenv, or project venv (created by install.sh)"
  exit 1
fi

# Check and install jq if needed (required for some level validations)
if ! command -v jq &> /dev/null; then
    echo "📦 jq not found. Installing jq (required for Level 33 and other validations)..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install jq || { echo "❌ Failed to install jq. Please install manually: brew install jq"; exit 1; }
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update && sudo apt-get install -y jq || { echo "❌ Failed to install jq. Please install manually: sudo apt-get install jq"; exit 1; }
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        echo "💡 For Windows, please install jq manually:"
        echo "   Option 1 (Chocolatey): choco install jq"
        echo "   Option 2 (Scoop): scoop install jq"
        echo "   Option 3: Download from https://stedolan.github.io/jq/download/"
        exit 1
    else
        echo "❌ Unsupported OS. Please install jq manually."
        echo "💡 Download from: https://stedolan.github.io/jq/download/"
        exit 1
    fi
    echo "✅ jq installed successfully"
fi

# Set PYTHONPATH to include the project root
export PYTHONPATH="$(pwd):$PYTHONPATH"

"$PYTHON" engine/engine.py

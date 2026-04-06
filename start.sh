#!/bin/bash
# Start both the API server and the frontend dev server

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Load .env if it exists
if [ -f "$ROOT/.env" ]; then
  export $(grep -v '^#' "$ROOT/.env" | xargs)
fi

if [ -z "$OPENWEATHER_API_KEY" ]; then
  echo ""
  echo "⚠  OPENWEATHER_API_KEY is not set."
  echo "   Copy .env.example to .env and add your key:"
  echo "   cp .env.example .env"
  echo "   Get a free key at: https://openweathermap.org/api"
  echo ""
fi

echo "Starting Erie Fishing Advisor..."
echo ""

# Start FastAPI backend
echo "→ API server: http://localhost:8000"
cd "$ROOT" && uvicorn api:app --reload --port 8000 &
API_PID=$!

# Start Vite frontend
echo "→ Frontend:   http://localhost:3000"
cd "$ROOT/frontend" && npm run dev &
FRONTEND_PID=$!

echo ""
echo "Press Ctrl+C to stop both servers."
echo ""

# Kill both on Ctrl+C
trap "kill $API_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait

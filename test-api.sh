#!/bin/bash

# Test script for Vercel API endpoint
# Usage: ./test-api.sh

ENDPOINT="https://copy-of-sportsync-ai-live-sports-analytics-9-83jt-4uvbjb3wp.vercel.app/api/chat"

echo "Testing Vercel API Endpoint..."
echo "URL: $ENDPOINT"
echo ""

curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Quick test: Lakers vs Celtics tonight. Should I take Lakers -3.5?"
      }
    ],
    "session_id": "test-session-'$(date +%s)'",
    "conversation_id": null,
    "gameContext": {
      "home_team": "Lakers",
      "away_team": "Celtics",
      "start_time": "'$(date -u -d "+2 hours" +%Y-%m-%dT%H:%M:%SZ)'",
      "status": "SCHEDULED",
      "current_odds": {
        "spread": -3.5,
        "total": 220.5,
        "moneyline_home": -150,
        "moneyline_away": +130
      }
    }
  }' \
  --no-buffer \
  -w "\n\nHTTP Status: %{http_code}\n"

echo ""
echo "Test complete!"

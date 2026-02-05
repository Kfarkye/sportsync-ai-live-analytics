#!/bin/bash

# Configuration
URL="https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/analyze-match"
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk"

# List of game IDs to fix
GAMES=(
    "401778331_ncaaf"
    "401778329_ncaaf"
    "401778328_ncaaf"
    "401772710_nfl"
    "401802976_nhl"
    "401802975_nhl"
    "401802974_nhl"
    "401802973_nhl"
)

echo "Starting clean backfill for ${#GAMES[@]} games..."

for game_id in "${GAMES[@]}"; do
    echo "Processing $game_id..."
    
    # Extract sport type from ID
    SPORT="generic"
    if [[ "$game_id" == *"_ncaaf"* ]]; then SPORT="ncaaf"; fi
    if [[ "$game_id" == *"_nfl"* ]]; then SPORT="nfl"; fi
    if [[ "$game_id" == *"_nhl"* ]]; then SPORT="nhl"; fi
    
    curl -X POST "$URL" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $KEY" \
        -d "{
            \"mode\": \"RECAP\",
            \"match\": {
                \"id\": \"$game_id\",
                \"sport\": \"$SPORT\"
            }
        }"
    
    echo -e "\nWaiting 3 seconds..."
    sleep 3
done

echo "Clean backfill finished!"

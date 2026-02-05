import requests
import datetime
import json
import sys

# Ensure output is printed immediately
sys.stdout.reconfigure(line_buffering=True)

def get_scores_for_date(date_str):
    url = f"http://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={date_str}"
    try:
        response = requests.get(url, timeout=10)
        data = response.json()
        games = []
        for event in data.get('events', []):
            competition = event['competitions'][0]
            if competition['status']['type']['state'] == 'post':
                home_score = int(competition['competitors'][0]['score'])
                away_score = int(competition['competitors'][1]['score'])
                games.append(home_score + away_score)
        return games
    except Exception as e:
        print(f"Error for {date_str}: {e}")
        return []

start_date = datetime.date(2025, 10, 21)
end_date = datetime.date(2026, 1, 5)
under_200_count = 0
total_games = 0

print(f"Scanning NBA games from {start_date} to {end_date}...")

current_date = start_date
while current_date <= end_date:
    date_str = current_date.strftime("%Y%m%d")
    scores = get_scores_for_date(date_str)
    for score in scores:
        total_games += 1
        if score < 200:
            under_200_count += 1
    current_date += datetime.timedelta(days=1)

print(f"Scan complete.")
print(f"Total games analyzed: {total_games}")
print(f"Games with < 200 total points: {under_200_count}")

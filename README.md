# SportsSync AI - Live Sports & Analytics

A premium real-time sports analytics dashboard with AI-powered insights.

## Environment Setup

### 1. Client-Side Environment Variables

Copy the example environment file:
```bash
cp .env.example .env.local
```

Then fill in your API keys in `.env.local`:

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Your Supabase anonymous/public key |
| `VITE_ODDS_API_KEY` | ⚠️ | The Odds API key (fallback only) |
| `GEMINI_API_KEY` | ✅ | Google Gemini AI API key |

### 2. Supabase Edge Function Secrets

These secrets are stored securely on Supabase (never exposed to clients):

```bash
# Set your Odds API key as a Supabase secret
supabase secrets set ODDS_API_KEY=your-key-here

# Or use an env file
supabase secrets set --env-file ./supabase/.env.secrets
```

| Secret | Required | Description |
|--------|----------|-------------|
| `ODDS_API_KEY` | ✅ | The Odds API paid tier key |

### 3. Deploy Edge Functions

```bash
# Login to Supabase CLI
supabase login

# Link to your project
supabase link --project-ref your-project-id

# Deploy all edge functions
supabase functions deploy
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## Production Build

```bash
# Create production build
npm run build

# Preview production build
npm run preview
```

## API Integrations

### ESPN API
- Scores & schedules
- Team stats & rosters
- Injury reports
- Rankings & standings

### The Odds API (Paid Tier)
- Real-time odds from 30+ bookmakers
- Player props (NBA, NFL, MLB, NHL)
- Line movement & historical odds
- Alternate spreads/totals
- Deep links to sportsbooks

### Google Gemini AI
- Match analysis & predictions
- Betting insights
- Natural language queries

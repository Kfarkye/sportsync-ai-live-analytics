# Vercel Deployment Guide

## Your Endpoint
```
https://copy-of-sportsync-ai-live-sports-analytics-9-83jt-4uvbjb3wp.vercel.app/api/chat
```

## ⚠️ IMPORTANT: Disable Deployment Protection

Your API endpoint requires **Deployment Protection** to be disabled or configured to allow public access.

### Fix Authentication Error

**Go to:** https://vercel.com/ro-user/copy-of-sportsync-ai-live-sports-analytics-9-83jt/settings/deployment-protection

Choose one of these options:

#### Option 1: Bypass API Routes (Recommended)
1. Keep "Standard Protection" enabled
2. Scroll to **"Bypassed Paths"**
3. Add: `/api/*`
4. Click "Save"

#### Option 2: Disable Protection Entirely
1. Select **"No Protection"** or **"Only Preview Deployments"**
2. Click "Save"

> **Note:** After changing protection settings, redeploy or wait ~1 minute for changes to propagate.

## Quick Deploy

### Option 1: Vercel Dashboard (Recommended)
1. Go to your Vercel dashboard: https://vercel.com/dashboard
2. Select your project: `copy-of-sportsync-ai-live-sports-analytics-9-83jt`
3. Go to "Settings" → "Git"
4. Ensure your GitHub repo is connected
5. Trigger a new deployment by:
   - Pushing to your `main` branch, OR
   - Click "Deployments" → "Redeploy"

### Option 2: Vercel CLI
```bash
# Install Vercel CLI (if not installed)
npm i -g vercel

# Login to Vercel
vercel login

# Link to existing project
vercel link

# Deploy to production
vercel --prod
```

## Environment Variables Setup

You MUST configure these environment variables in Vercel:

### Via Vercel Dashboard:
1. Go to: https://vercel.com/ro-user/copy-of-sportsync-ai-live-sports-analytics-9-83jt/settings/environment-variables
2. Add the following variables:

| Variable Name | Value | Environment |
|---------------|-------|-------------|
| `GEMINI_API_KEY` | Your Gemini API key | Production |
| `OPENAI_API_KEY` | Your OpenAI API key | Production |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Production |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase URL | Production |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key | Production |

### Via Vercel CLI:
```bash
vercel env add GEMINI_API_KEY production
vercel env add OPENAI_API_KEY production
vercel env add ANTHROPIC_API_KEY production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

## Test Your Deployment

### Using the test script:
```bash
chmod +x test-api.sh
./test-api.sh
```

### Using curl directly:
```bash
curl -X POST https://copy-of-sportsync-ai-live-sports-analytics-9-83jt-4uvbjb3wp.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Test"}],
    "session_id": "test-123",
    "gameContext": {
      "home_team": "Lakers",
      "away_team": "Celtics"
    }
  }'
```

## Deployment Checklist

- [ ] Code pushed to GitHub
- [ ] Vercel project connected to GitHub repo
- [ ] Environment variables configured
- [ ] Deployment triggered
- [ ] API endpoint responding
- [ ] SSE streaming working
- [ ] Gemini 3 thinking mode enabled
- [ ] Database picks being saved

## Troubleshooting

### ❌ "Authentication Required" HTML Response
**Symptom:** API returns HTML authentication page instead of JSON

**Cause:** Deployment Protection is enabled

**Fix:**
1. Go to: https://vercel.com/ro-user/copy-of-sportsync-ai-live-sports-analytics-9-83jt/settings/deployment-protection
2. Either:
   - Add `/api/*` to "Bypassed Paths", OR
   - Disable protection entirely
3. Save and wait ~60 seconds
4. Test again: `curl https://your-url.vercel.app/api/chat`

### Deployment fails
- Check build logs in Vercel dashboard
- Verify all dependencies are in package.json
- Ensure Node.js version is 20.x

### API returns 500 errors
- Check environment variables are set correctly
- Verify Gemini API key is valid
- Check Supabase credentials
- Review function logs in Vercel dashboard

### No streaming response
- Verify SSE headers are being sent
- Check browser network tab for event-stream
- Ensure client is handling SSE correctly

## Features Deployed

✅ **Gemini 3 Flash Preview** integration
✅ **Native thinking mode** (high level reasoning)
✅ **Multimodal support** (images/screenshots)
✅ **SSE streaming** (thought vs text separation)
✅ **Market phase detection**
✅ **Pick extraction & persistence**
✅ **Supabase database integration**

## Production URL
```
https://copy-of-sportsync-ai-live-sports-analytics-9-83jt-4uvbjb3wp.vercel.app
```

## API Documentation

### Endpoint
`POST /api/chat`

### Request Body
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Your message here"
    }
  ],
  "session_id": "unique-session-id",
  "conversation_id": "optional-conversation-id",
  "gameContext": {
    "home_team": "Team Name",
    "away_team": "Team Name",
    "start_time": "2026-01-24T19:00:00Z",
    "status": "SCHEDULED",
    "current_odds": {
      "spread": -3.5,
      "total": 220.5
    }
  }
}
```

### Response (SSE Stream)
```
data: {"type":"thought","content":"Internal reasoning..."}

data: {"type":"text","content":"Verdict: Lakers -3.5"}

data: {"done":true,"model":"gemini-3-flash-preview","sources":[...]}
```

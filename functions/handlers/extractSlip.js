// functions/handlers/extractSlip.js
// Migrated from api/extract-slip.js — native Cloud Function, zero Vercel.

import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { AIParsedSlipSchema } from '../lib/betSlipSchema.js';

export const extractSlip = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '512MiB',
    cors: true,
    secrets: ['GOOGLE_GENERATIVE_AI_API_KEY'],
  },
  async (req, res) => {
    // CORS preflight
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const imageData = body?.image;
      if (!imageData) {
        res.status(400).json({ error: 'Missing image data' });
        return;
      }

      // Accept base64 data URL or raw base64
      let base64Content = imageData;
      let mimeType = 'image/png';
      if (imageData.startsWith('data:')) {
        const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64Content = match[2];
        }
      }

      const systemPrompt = `You are a precise betting slip extraction AI. Analyze the provided bet slip image and extract all visible information with maximum accuracy.

Rules:
- Extract EVERY leg visible on the slip
- For odds, use American format (e.g., -110, +150)
- If a value is not clearly visible, set needs_review to true
- confidence_score reflects how clearly you can read each field (0-100)
- Identify the sportsbook from UI branding/colors
- Detect parlay vs straight vs SGP from slip layout`;

      const result = await generateObject({
        model: google('gemini-2.0-flash'),
        schema: AIParsedSlipSchema,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all betting information from this slip image.' },
              { type: 'image', image: base64Content, mimeType },
            ],
          },
        ],
      });

      // Inject server-side UUIDs (never trust LLM-generated IDs)
      const { randomUUID } = await import('node:crypto');
      const slip = {
        id: randomUUID(),
        ...result.object,
        legs: result.object.legs.map(leg => ({
          id: randomUUID(),
          ...leg,
        })),
        parsed_at: new Date().toISOString(),
        verified: false,
      };

      res.status(200).json(slip);
    } catch (error) {
      logger.error('[extractSlip] Extraction failed:', error?.message || error);
      res.status(500).json({
        error: 'extraction_failed',
        message: error?.message || 'Failed to extract bet slip',
      });
    }
  }
);

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

// Load environment
const loadEnv = () => {
    ['.env', '.env.local'].forEach(file => {
        const envPath = path.resolve(process.cwd(), file);
        if (fs.existsSync(envPath)) {
            const env = fs.readFileSync(envPath, 'utf8');
            env.split('\n').forEach(line => {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    process.env[key.trim()] = valueParts.join('=').trim();
                }
            });
        }
    });
};

loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Missing SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local");
    process.exit(1);
}

async function testChatStream() {
    console.log("🚀 Testing Chat Stream Backend...");

    const payload = {
        messages: [
            { role: "user", content: "Tell me about the edge in the Lakers vs Suns game tomorrow." }
        ],
        current_match: {
            match_id: "401704831", // A real or canonical ID
            away_team: "Los Angeles Lakers",
            home_team: "Phoenix Suns",
            league: "nba"
        }
    };

    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.text();
        console.error("❌ Request Failed:", response.status, err);
        return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    console.log("📥 Stream Connected. Auditing Chunks...");

    let chunkCount = 0;
    let hasThoughts = false;
    let hasText = false;
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.trim()) continue;
            console.log(`[RAW LINE] ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
            chunkCount++;
            try {
                const data = JSON.parse(line);
                console.log(`   -> Parsed type: ${data.type}`);

                if (data.type === 'thoughts') {
                    hasThoughts = true;
                    if (chunkCount < 5) console.log("   Thought Snippet:", data.content.substring(0, 50));
                }
                if (data.type === 'text') {
                    hasText = true;
                    if (chunkCount < 10) console.log("   Text Snippet:", data.content.substring(0, 50));
                }
                if (data.type === 'done') {
                    console.log("✅ Final Payload Received:", data.metadata ? "Metadata Present" : "No Metadata");
                }
            } catch (e) {
                console.warn("⚠️ Line Parse Warning:", line.substring(0, 50));
            }
        }
    }

    console.log("\n📊 AUDIT SUMMARY:");
    console.log("- Total Chunks Collected:", chunkCount);
    console.log("- Thought Stream Active:", hasThoughts ? "YES" : "NO");
    console.log("- Text Stream Active:", hasText ? "YES" : "NO");
    console.log("- Verdict:", (hasText && chunkCount > 5) ? "PASS (High Bandwidth Stream)" : "FAIL (Insufficient Velocity)");
}

testChatStream().catch(console.error);

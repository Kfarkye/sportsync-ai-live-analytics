import handler from "../api/chat.js";
import { Writable } from "stream";

// 1. Mock Request
const req = {
    method: "POST", headers: {}, body: {
        session_id: "test", conversation_id: "test", run_id: "test",
        messages: [{ role: "user", content: "sharp report" }],
        gameContext: { match_id: "test-game", home_team: "Home", away_team: "Away", sport: "NBA", league: "NBA" }
    },
    once: () => { }, removeListener: () => { }
};

// 2. Mock Response
class MockResponse extends Writable {
    constructor() { super(); this.headersSent = false; this.headers = {}; }
    status(c) { this.statusCode = c; return this; }
    json(d) { console.log("[JSON]:", JSON.stringify(d)); }
    writeHead(s, h) { this.statusCode = s; this.headers = h; this.headersSent = true; }
    flushHeaders() { }
    _write(c, _, cb) { console.log("[SSE]:", c.toString().trim()); cb(); }
}

try {
    const res = new MockResponse();
    await handler(req, res);
} catch (e) {
    console.error("Uncaught fallback script error:", e);
}

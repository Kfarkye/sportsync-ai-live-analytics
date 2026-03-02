import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

const FONT = `'JetBrains Mono', 'Fira Code', monospace`;
const SANS = `'SF Pro Display', -apple-system, 'Helvetica Neue', sans-serif`;
const SERIF = `'Newsreader', Georgia, serif`;

const C = {
    bg: "#060606",
    surface: "#0D0D0D",
    surface2: "#141414",
    border: "rgba(255,255,255,0.06)",
    text: "#F8F8F8",
    text2: "#A0A0A0",
    text3: "#666666",
    accent: "#3B82F6",
    green: "#10B981",
    red: "#EF4444",
    amber: "#F59E0B",
    purple: "#8B5CF6",
    cyan: "#06B6D4",
};

export default function ESPNAnatomy() {
    const [ready, setReady] = useState(false);
    useEffect(() => { setTimeout(() => setReady(true), 50); }, []);

    return (
        <div style={{
            minHeight: "100vh", background: C.bg, color: C.text,
            fontFamily: SANS, padding: "0 0 100px",
            opacity: ready ? 1 : 0, transition: "opacity 0.6s ease-out"
        }}>
            <style>{`
        ::selection { background: ${C.accent}40; color: #fff; }
        .hero-glow { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
        .hero-glow::before { content: ''; position: absolute; top: -20%; left: -10%; width: 50%; height: 50%; background: ${C.accent}; opacity: 0.08; filter: blur(120px); border-radius: 50%; }
        .hero-glow::after { content: ''; position: absolute; top: 10%; right: -10%; width: 40%; height: 40%; background: ${C.purple}; opacity: 0.06; filter: blur(100px); border-radius: 50%; }
        
        .nav-link { font-family: ${FONT}; font-size: 10px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.text2}; text-decoration: none; transition: color 0.2s; padding: 6px 12px; border: 1px solid transparent; border-radius: 6px; }
        .nav-link:hover { color: #fff; background: rgba(255,255,255,0.03); border-color: ${C.border}; }
        
        .section-card { background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 24px; padding: 40px; margin-bottom: 32px; position: relative; overflow: hidden; }
        .section-card::after { content: ''; position: absolute; inset: 0; pointer-events: none; border: 1px solid rgba(255,255,255,0.03); border-radius: 24px; }
        
        .grid-row { display: grid; grid-template-columns: 240px 1fr; gap: 40px; }
        @media (max-width: 800px) { .grid-row { grid-template-columns: 1fr; gap: 20px; } }
        
        .data-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; font-family: ${FONT}; font-size: 10px; font-weight: 600; letter-spacing: 0.05em; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); }
        .data-pill.critical { background: ${C.accent}15; border-color: ${C.accent}30; color: ${C.accent}; }
        
        .code-block { font-family: ${FONT}; font-size: 11px; line-height: 1.6; color: ${C.text2}; background: #000; padding: 20px; border-radius: 12px; border: 1px solid ${C.border}; overflow-x: auto; }
        .code-block b { color: #fff; font-weight: 600; }
        .code-block i { color: ${C.accent}; font-style: normal; }
        .code-block s { color: ${C.red}; text-decoration: line-through; opacity: 0.8; }
        .code-block u { color: ${C.green}; text-decoration: none; }
        
        .stat-huge { font-family: ${SERIF}; font-size: 64px; font-weight: 400; line-height: 1; letter-spacing: -0.04em; margin-bottom: 8px; }
        .stat-label { font-family: ${SANS}; font-size: 11px; font-weight: 600; color: ${C.text2}; letter-spacing: 0.08em; text-transform: uppercase; }
        
        .metric-box { border-top: 1px solid ${C.border}; padding-top: 16px; margin-top: 16px; }
      `}</style>

            {/* Global Header */}
            <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,6,6,0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ maxWidth: 1080, margin: "0 auto", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Link to="/reports" className="nav-link">← Reports</Link>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, boxShadow: `0 0 10px ${C.green}` }} />
                        <span style={{ fontFamily: FONT, fontSize: 10, color: C.green, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>Live Probe Connected</span>
                    </div>
                </div>
            </div>

            <div className="hero-glow" />

            <main style={{ maxWidth: 1080, margin: "0 auto", padding: "60px 24px", position: "relative", zIndex: 10 }}>

                {/* Editorial Hero */}
                <header style={{ marginBottom: 80, maxWidth: 800 }}>
                    <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
                        <span className="data-pill">ARS 2-1 CHE</span>
                        <span className="data-pill">Event ID: 740871</span>
                        <span className="data-pill">Payload: 260KB</span>
                        <span className="data-pill" style={{ borderColor: `${C.amber}50`, color: C.amber }}>API: v3/Summary</span>
                    </div>

                    <h1 style={{ fontFamily: SERIF, fontSize: 56, fontWeight: 400, lineHeight: 1.1, letterSpacing: "-0.02em", color: "#fff", marginBottom: 24 }}>
                        Anatomy of the Feed.<br />
                        <span style={{ color: C.text3 }}>Mapping the deepest layers of ESPN's live market data.</span>
                    </h1>

                    <p style={{ fontFamily: SANS, fontSize: 18, lineHeight: 1.6, color: C.text2, maxWidth: 640 }}>
                        ESPN's public <code style={{ fontFamily: FONT, fontSize: 15, background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 4 }}>/summary</code> endpoint is a firehose.
                        A single request contains up to 260KB of nested JSON traversing play-by-play, live win probability, and full market depth across multiple sportsbooks.
                        Here is the exact topography of that data—and the extraction bugs we are fixing.
                    </p>
                </header>

                {/* Section 1: The Payload Topography */}
                <section className="section-card">
                    <div className="grid-row">
                        <div>
                            <div className="stat-label" style={{ color: C.accent, marginBottom: 16 }}>01. Topography</div>
                            <h2 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, color: "#fff", marginBottom: 16, lineHeight: 1.1 }}>The 260KB Payload</h2>
                            <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.6 }}>
                                18 top-level keys. Most are noise (videos, articles). The intelligence lies in three specific nodes.
                            </p>
                        </div>

                        <div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                {[
                                    { k: "pickcenter[0]", desc: "DraftKings 3-Way ML, Spread, Total + Open/Close lines", type: "critical" },
                                    { k: "odds[1]", desc: "Bet365 Deep Markets (192+ player props, 22 team lines)", type: "critical" },
                                    { k: "keyEvents", desc: "Wallclock-stamped match events for temporal joins", type: "critical" },
                                    { k: "commentary", desc: "Minute-by-minute text play-by-play", type: "available" },
                                    { k: "boxscore", desc: "Traditional counting stats", type: "available" },
                                    { k: "rosters", desc: "Player metadata & IDs", type: "available" }
                                ].map((n, i) => (
                                    <div key={i} style={{ padding: 20, background: n.type === "critical" ? "rgba(59,130,246,0.04)" : "rgba(255,255,255,0.02)", borderRadius: 16, border: `1px solid ${n.type === "critical" ? "rgba(59,130,246,0.15)" : C.border}` }}>
                                        <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: n.type === "critical" ? C.accent : "#fff", marginBottom: 8 }}>{n.k}</div>
                                        <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.5 }}>{n.desc}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Section 2: DraftKings Extraction Bug */}
                <section className="section-card" style={{ background: "linear-gradient(135deg, #0d0d0d 0%, #1a0f0f 100%)", borderColor: "rgba(239,68,68,0.15)" }}>
                    <div className="grid-row">
                        <div>
                            <div className="stat-label" style={{ color: C.red, marginBottom: 16 }}>02. Critical Bug</div>
                            <h2 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, color: "#fff", marginBottom: 16, lineHeight: 1.1 }}>The Draw ML Collapse</h2>
                            <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.6 }}>
                                The v3 drain function misinterprets the shape of the DraftKings Draw Odds object.
                                Instead of traversing to the integer, it attempts to parse the parent object, returning <code style={{ fontFamily: FONT }}>NaN</code>.
                            </p>

                            <div className="metric-box" style={{ borderColor: "rgba(239,68,68,0.2)", marginTop: 32 }}>
                                <div className="stat-huge" style={{ color: C.red }}>418</div>
                                <div className="stat-label">Corrupted Rows in Postgres</div>
                            </div>
                        </div>

                        <div>
                            <div className="code-block" style={{ marginBottom: 16 }}>
                                <div style={{ fontFamily: SANS, fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Current (Failing) Drain Logic</div>
                                <code>
                  // Attempting to parse object as integer<br />
                                    if (pc.drawOdds !== undefined) {"{"}<br />
                                    &nbsp;&nbsp;dk_draw_ml = <s>safeInt(pc.drawOdds)</s>;<br />
                                    {"}"}<br />
                                    <br />
                                    <span style={{ color: C.text3 }}>// Execution flow:</span><br />
                                    <span style={{ color: C.text3 }}>// pc.drawOdds = {"{ moneyLine: 340 }"}</span><br />
                                    <span style={{ color: C.text3 }}>// safeInt({"{"} moneyLine: 340 {"}"}) {"->"} NaN {"->"} NULL</span>
                                </code>
                            </div>

                            <div className="code-block" style={{ background: "rgba(16,185,129,0.05)", borderColor: "rgba(16,185,129,0.2)" }}>
                                <div style={{ fontFamily: SANS, fontSize: 10, color: C.green, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>The Fix</div>
                                <code>
                  // Safely traverse to moneyLine property<br />
                                    dk_draw_ml = <u>safeInt(pc.drawOdds?.moneyLine)</u>;<br /><br />
                                    <span style={{ color: C.text3 }}>// Output: 340</span>
                                </code>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Section 3: The Line Movement Opportunity */}
                <section className="section-card">
                    <div className="grid-row">
                        <div>
                            <div className="stat-label" style={{ color: C.green, marginBottom: 16 }}>03. Market Alpha</div>
                            <h2 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, color: "#fff", marginBottom: 16, lineHeight: 1.1 }}>Line Movement Signals</h2>
                            <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.6 }}>
                                The <code style={{ fontFamily: FONT }}>pickcenter</code> array silently carries open and close prices for every major market.
                                This data allows us to track sharp money and steam without needing a historical tick database.
                            </p>
                        </div>

                        <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24, padding: "20px 24px", background: "rgba(255,255,255,0.03)", borderRadius: 16 }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontFamily: FONT, fontSize: 11, color: C.text3, marginBottom: 4 }}>HOME ML OPEN</div>
                                    <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 600, color: "#fff" }}>-150</div>
                                </div>
                                <div style={{ width: 40, height: 1, background: C.border, position: "relative" }}>
                                    <div style={{ position: "absolute", right: 0, top: -4, width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: `6px solid ${C.border}` }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontFamily: FONT, fontSize: 11, color: C.green, marginBottom: 4 }}>HOME ML CLOSE (STEAM)</div>
                                    <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 600, color: C.green }}>-190</div>
                                </div>
                            </div>

                            <div className="code-block">
                                <div style={{ fontFamily: SANS, fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Untapped Fields for Extraction</div>
                                <code>
                                    dk_home_ml_open = safeInt(pc.moneyline?.home?.open?.odds);<br />
                                    dk_home_ml_close = safeInt(pc.moneyline?.home?.close?.odds);<br />
                                    dk_spread_open = parseFloat(pc.pointSpread?.home?.open?.line);<br />
                                    dk_spread_close = parseFloat(pc.pointSpread?.home?.close?.line);<br />
                                    dk_total_open = parseFloat(pc.total?.over?.open?.line?.replace('o',''));
                                </code>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Section 4: Bet365 Deep Markets */}
                <section className="section-card">
                    <div className="grid-row" style={{ gridTemplateColumns: "1fr" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
                            <div style={{ maxWidth: 400 }}>
                                <div className="stat-label" style={{ color: C.purple, marginBottom: 16 }}>04. The Depths</div>
                                <h2 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, color: "#fff", marginBottom: 16, lineHeight: 1.1 }}>Bet365 Exotic Markets</h2>
                                <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.6 }}>Fractional odds natively structured for European books. Includes 192 distinct player prop odds.</p>
                            </div>
                            <div style={{ textAlign: "right" }}>
                                <div className="stat-huge" style={{ color: C.purple }}>192</div>
                                <div className="stat-label">Player Prop Markets</div>
                            </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                            {[
                                { label: "Gyökeres Anytime Goal", val: "11/10", tag: "LIVE" },
                                { label: "Jesus First Goal", val: "9/2", tag: "PRE" },
                                { label: "Home/Draw Double", val: "1/8", tag: "PRE" },
                                { label: "Over 3.5 Goals", val: "4/1", tag: "LIVE" }
                            ].map((m, i) => (
                                <div key={i} style={{ padding: 20, background: "rgba(255,255,255,0.02)", borderRadius: 16, border: `1px solid ${C.border}` }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                                        <span className="data-pill" style={{ background: "transparent", border: `1px solid ${C.purple}40`, color: C.purple, padding: "2px 6px", fontSize: 8 }}>{m.tag}</span>
                                    </div>
                                    <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 600, color: "#fff", marginBottom: 8 }}>{m.val}</div>
                                    <div style={{ fontSize: 12, color: C.text2 }}>{m.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

            </main>
        </div>
    );
}

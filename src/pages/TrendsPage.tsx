import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
    SoccerPostgame,
    fetchRecentMatches,
    getSpreadResult,
    getTotalResult,
    fmtOdds,
    impliedProb
} from '../lib/postgame';
import { matchUrl, formatMatchDate, LEAGUE_LABELS, LEAGUE_SHORT } from '../lib/slugs';

const FONT = `'JetBrains Mono', 'Fira Code', monospace`;
const SANS = `'SF Pro Display', -apple-system, 'Helvetica Neue', sans-serif`;
const SERIF = `'Newsreader', Georgia, serif`;

const C = {
    bg: "#060606", surface: "#0C0C0C", border: "rgba(255,255,255,0.06)",
    text: "#F0F0F0", text2: "#9A9A9A", text3: "#555",
    green: "#10B981", red: "#EF4444", amber: "#F59E0B", accent: "#3B82F6", purple: "#8B5CF6", cyan: "#06B6D4",
};

export default function TrendsPage() {
    const [matches, setMatches] = useState<SoccerPostgame[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchRecentMatches(200).then(d => { setMatches(d); setLoading(false); });
        document.title = 'Betting Trends | The Drip';
    }, []);

    const data = useMemo(() => {
        if (!matches.length) return null;

        let homeCovers = 0, awayCovers = 0, pushes = 0, atsTotal = 0;
        let overs = 0, unders = 0, ouPush = 0, ouTotal = 0;
        let favWins = 0, dogWins = 0, mlTotal = 0, totalGoals = 0;
        const upsets: SoccerPostgame[] = [];
        const highScoring: SoccerPostgame[] = [];

        const byLeague: Record<string, { n: number; hc: number; at: number; ov: number; ot: number; g: number }> = {};

        for (const m of matches) {
            const lid = m.league_id;
            if (!byLeague[lid]) byLeague[lid] = { n: 0, hc: 0, at: 0, ov: 0, ot: 0, g: 0 };
            byLeague[lid].n++;

            const goals = m.home_score + m.away_score;
            totalGoals += goals;
            byLeague[lid].g += goals;
            if (goals >= 5) highScoring.push(m);

            const sr = getSpreadResult(m);
            if (sr) {
                atsTotal++; byLeague[lid].at++;
                if (sr.result === 'covered') { homeCovers++; byLeague[lid].hc++; }
                else if (sr.result === 'failed') awayCovers++;
                else pushes++;
            }

            const tr = getTotalResult(m);
            if (tr) {
                ouTotal++; byLeague[lid].ot++;
                if (tr.result === 'over') { overs++; byLeague[lid].ov++; }
                else if (tr.result === 'under') unders++;
                else ouPush++;
            }

            if (m.dk_home_ml != null && m.dk_away_ml != null) {
                mlTotal++;
                const hFav = m.dk_home_ml < m.dk_away_ml;
                const hW = m.home_score > m.away_score;
                const aW = m.away_score > m.home_score;
                if ((hFav && hW) || (!hFav && aW)) favWins++;
                if ((hFav && aW) || (!hFav && hW)) {
                    dogWins++;
                    const dogLine = hFav ? m.dk_away_ml : m.dk_home_ml;
                    if (dogLine != null && dogLine >= 200) upsets.push(m);
                }
            }
        }

        upsets.sort((a, b) => Math.max(b.dk_home_ml || 0, b.dk_away_ml || 0) - Math.max(a.dk_home_ml || 0, a.dk_away_ml || 0));
        highScoring.sort((a, b) => (b.home_score + b.away_score) - (a.home_score + a.away_score));

        const leagues = Object.entries(byLeague).map(([id, d]) => ({
            id, label: LEAGUE_LABELS[id] || id, short: LEAGUE_SHORT[id] || id,
            n: d.n,
            hcPct: d.at > 0 ? (d.hc / d.at * 100) : 0,
            ovPct: d.ot > 0 ? (d.ov / d.ot * 100) : 0,
            avgG: d.n > 0 ? d.g / d.n : 0,
        })).sort((a, b) => b.n - a.n);

        return {
            total: matches.length,
            avgGoals: (totalGoals / matches.length).toFixed(2),
            ats: { homeCovers, awayCovers, pushes, total: atsTotal, pct: atsTotal ? (homeCovers / atsTotal * 100) : 0 },
            ou: { overs, unders, push: ouPush, total: ouTotal, pct: ouTotal ? (overs / ouTotal * 100) : 0 },
            ml: { favWins, dogWins, total: mlTotal, pct: mlTotal ? (favWins / mlTotal * 100) : 0 },
            upsets: upsets.slice(0, 6),
            highScoring: highScoring.slice(0, 6),
            leagues,
        };
    }, [matches]);

    if (loading) return <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.text3, fontFamily: FONT, fontSize: 12 }}>Loading...</div>;
    if (!data) return null;

    return (
        <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: SANS }}>
            <style>{`
                * { box-sizing: border-box; }
                html, body { overflow-x: hidden; }
                ::selection { background: rgba(59,130,246,0.3); }
                .sticky-nav { position: sticky; top: 0; z-index: 50; background: rgba(6,6,6,0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-bottom: 1px solid ${C.border}; }
                .kpi { padding: 24px; background: rgba(255,255,255,0.015); border: 1px solid ${C.border}; border-radius: 16px; transition: all 0.2s; }
                .kpi:hover { background: rgba(255,255,255,0.025); border-color: rgba(255,255,255,0.09); }
                .bar-track { height: 5px; background: rgba(255,255,255,0.04); border-radius: 3px; overflow: hidden; margin-top: 14px; }
                .bar-fill { height: 100%; border-radius: 3px; transition: width 1s cubic-bezier(0.4,0,0.2,1); }
                .game-row { display: grid; grid-template-columns: 1fr 80px 70px; gap: 12px; align-items: center; padding: 14px 18px; background: rgba(255,255,255,0.012); border: 1px solid ${C.border}; border-radius: 12px; text-decoration: none; color: inherit; transition: all 0.15s; }
                .game-row:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); }
                .lg-row { display: grid; grid-template-columns: 1fr 60px 80px 80px 70px; gap: 12px; align-items: center; padding: 14px 20px; border-radius: 10px; transition: background 0.15s; }
                .lg-row:hover { background: rgba(255,255,255,0.02); }
                .split-bar { display: flex; gap: 0; height: 6px; border-radius: 3px; overflow: hidden; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
            `}</style>

            <div className="sticky-nav">
                <div style={{ maxWidth: 1080, margin: "0 auto", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Link to="/" style={{ fontFamily: FONT, fontSize: 10, color: C.text3, textDecoration: "none", padding: "4px 10px", border: `1px solid ${C.border}`, borderRadius: 6, letterSpacing: "0.06em" }}>← HOME</Link>
                        <Link to="/reports" style={{ fontFamily: FONT, fontSize: 10, color: C.text3, textDecoration: "none", padding: "4px 10px", border: `1px solid ${C.border}`, borderRadius: 6, letterSpacing: "0.06em" }}>REPORTS</Link>
                    </div>
                    <span style={{ fontFamily: FONT, fontSize: 10, color: C.text3 }}>{data.total} matches</span>
                </div>
            </div>

            <main style={{ maxWidth: 1080, margin: "0 auto", padding: "48px 24px 100px" }}>
                <header style={{ marginBottom: 48 }}>
                    <h1 style={{ fontFamily: SERIF, fontSize: 44, fontWeight: 400, margin: "0 0 8px", letterSpacing: "-0.02em", lineHeight: 1.15 }}>Betting Trends</h1>
                    <p style={{ fontSize: 16, color: C.text2, margin: 0 }}>Cross-league cover rates, totals, and market outcomes from DraftKings closing lines.</p>
                </header>

                {/* KPIs */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 48 }}>
                    {[
                        { val: `${data.ats.pct.toFixed(1)}%`, label: "Home Cover Rate", sub: `${data.ats.homeCovers} of ${data.ats.total}`, color: data.ats.pct > 50 ? C.green : C.red, pct: data.ats.pct },
                        { val: `${data.ou.pct.toFixed(1)}%`, label: "Overs Rate", sub: `${data.ou.overs} of ${data.ou.total}`, color: data.ou.pct > 50 ? C.amber : C.cyan, pct: data.ou.pct },
                        { val: `${data.ml.pct.toFixed(1)}%`, label: "Favorites Win", sub: `${data.ml.favWins} of ${data.ml.total}`, color: C.accent, pct: data.ml.pct },
                        { val: data.avgGoals, label: "Avg Goals", sub: `${data.total} matches`, color: C.text, pct: (parseFloat(data.avgGoals) / 5) * 100 },
                    ].map((k, i) => (
                        <div key={i} className="kpi" style={{ animation: `fadeIn 0.3s ease ${i * 0.06}s both` }}>
                            <div style={{ fontFamily: SERIF, fontSize: 36, fontWeight: 400, color: k.color, lineHeight: 1 }}>{k.val}</div>
                            <div style={{ fontSize: 13, color: C.text2, marginTop: 10, fontWeight: 500 }}>{k.label}</div>
                            <div style={{ fontFamily: FONT, fontSize: 10, color: C.text3, marginTop: 2 }}>{k.sub}</div>
                            <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(k.pct, 100)}%`, background: k.color }} /></div>
                        </div>
                    ))}
                </div>

                {/* League Breakdown */}
                <section style={{ marginBottom: 48 }}>
                    <h2 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>By League</h2>
                    <div style={{ padding: "0 20px", display: "grid", gridTemplateColumns: "1fr 60px 80px 80px 70px", gap: 12, fontSize: 10, color: C.text3, fontFamily: FONT, letterSpacing: "0.06em", marginBottom: 4 }}>
                        <span>League</span><span>Games</span><span>Home ATS</span><span>Over %</span><span>Goals</span>
                    </div>
                    {data.leagues.map((l, i) => (
                        <div key={l.id} className="lg-row" style={{ animation: `fadeIn 0.2s ease ${i * 0.04}s both` }}>
                            <span style={{ fontWeight: 600, fontSize: 15 }}>{l.label}</span>
                            <span style={{ fontFamily: FONT, fontSize: 13, color: C.text2, textAlign: "center" }}>{l.n}</span>
                            <span style={{ fontFamily: FONT, fontSize: 13, color: l.hcPct > 52 ? C.green : l.hcPct < 48 ? C.red : C.text, textAlign: "center", fontWeight: 600 }}>{l.hcPct.toFixed(1)}%</span>
                            <span style={{ fontFamily: FONT, fontSize: 13, color: l.ovPct > 52 ? C.amber : C.text, textAlign: "center" }}>{l.ovPct.toFixed(1)}%</span>
                            <span style={{ fontFamily: FONT, fontSize: 13, color: C.text2, textAlign: "center" }}>{l.avgG.toFixed(2)}</span>
                        </div>
                    ))}
                </section>

                {/* ATS / OU Splits */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 48 }}>
                    <div className="kpi">
                        <div style={{ fontFamily: FONT, fontSize: 10, color: C.text3, letterSpacing: "0.08em", marginBottom: 16 }}>ATS SPLIT</div>
                        <div className="split-bar" style={{ marginBottom: 16 }}>
                            <div style={{ width: `${data.ats.pct}%`, background: C.green }} />
                            <div style={{ width: `${100 - data.ats.pct - (data.ats.total > 0 ? data.ats.pushes / data.ats.total * 100 : 0)}%`, background: C.red }} />
                            <div style={{ flex: 1, background: C.text3 }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: FONT }}>
                            <span style={{ color: C.green }}>Home {data.ats.homeCovers}</span>
                            <span style={{ color: C.red }}>Away {data.ats.awayCovers}</span>
                            <span style={{ color: C.text3 }}>Push {data.ats.pushes}</span>
                        </div>
                    </div>
                    <div className="kpi">
                        <div style={{ fontFamily: FONT, fontSize: 10, color: C.text3, letterSpacing: "0.08em", marginBottom: 16 }}>O/U SPLIT</div>
                        <div className="split-bar" style={{ marginBottom: 16 }}>
                            <div style={{ width: `${data.ou.pct}%`, background: C.amber }} />
                            <div style={{ width: `${100 - data.ou.pct - (data.ou.total > 0 ? data.ou.push / data.ou.total * 100 : 0)}%`, background: C.cyan }} />
                            <div style={{ flex: 1, background: C.text3 }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: FONT }}>
                            <span style={{ color: C.amber }}>Over {data.ou.overs}</span>
                            <span style={{ color: C.cyan }}>Under {data.ou.unders}</span>
                            <span style={{ color: C.text3 }}>Push {data.ou.push}</span>
                        </div>
                    </div>
                </div>

                {/* Upsets + High Scoring */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
                    <section>
                        <h2 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>Biggest Upsets</h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {data.upsets.map((m, i) => {
                                const hFav = (m.dk_home_ml ?? 0) < (m.dk_away_ml ?? 0);
                                const dog = hFav ? m.away_team : m.home_team;
                                const line = hFav ? m.dk_away_ml : m.dk_home_ml;
                                return (
                                    <Link to={matchUrl(m.home_team, m.away_team, m.start_time)} key={m.id} className="game-row" style={{ animation: `fadeIn 0.2s ease ${i * 0.04}s both` }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 14 }}>{dog}</div>
                                            <div style={{ fontFamily: FONT, fontSize: 10, color: C.text3, marginTop: 2 }}>{LEAGUE_SHORT[m.league_id]} · {formatMatchDate(m.start_time)}</div>
                                        </div>
                                        <div style={{ fontFamily: SERIF, fontSize: 18, textAlign: "right", color: C.text2 }}>{m.home_score}-{m.away_score}</div>
                                        <div style={{ fontFamily: FONT, fontSize: 13, textAlign: "right", color: C.green, fontWeight: 600 }}>{fmtOdds(line!)}</div>
                                    </Link>
                                );
                            })}
                        </div>
                    </section>
                    <section>
                        <h2 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>Highest Scoring</h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {data.highScoring.map((m, i) => (
                                <Link to={matchUrl(m.home_team, m.away_team, m.start_time)} key={m.id} className="game-row" style={{ animation: `fadeIn 0.2s ease ${i * 0.04}s both` }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>{m.home_team} vs {m.away_team}</div>
                                        <div style={{ fontFamily: FONT, fontSize: 10, color: C.text3, marginTop: 2 }}>{LEAGUE_SHORT[m.league_id]} · {formatMatchDate(m.start_time)}</div>
                                    </div>
                                    <div style={{ fontFamily: SERIF, fontSize: 18, textAlign: "right", color: C.amber }}>{m.home_score}-{m.away_score}</div>
                                    <div style={{ fontFamily: FONT, fontSize: 12, textAlign: "right", color: C.text3 }}>{m.home_score + m.away_score} goals</div>
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

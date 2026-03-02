import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
    SoccerPostgame,
    fetchRecentMatches,
    getSpreadResult,
    getTotalResult,
    getMLResult,
    impliedProb,
    fmtOdds
} from '../lib/postgame';
import { matchUrl, teamUrl, formatMatchDate, LEAGUE_LABELS, LEAGUE_SHORT } from '../lib/slugs';

const FONT = `'JetBrains Mono', 'Fira Code', monospace`;
const SANS = `'SF Pro Display', -apple-system, 'Helvetica Neue', sans-serif`;
const SERIF = `'Newsreader', Georgia, serif`;

const C = {
    bg: "#060606", surface: "#0D0D0D", border: "rgba(255,255,255,0.06)",
    text: "#F8F8F8", text2: "#A0A0A0", text3: "#666666",
    accent: "#3B82F6", green: "#10B981", red: "#EF4444",
    amber: "#F59E0B", purple: "#8B5CF6", cyan: "#06B6D4",
};

interface TrendRow {
    label: string; value: string; pct: number; color: string; sub?: string;
}

export default function TrendsPage() {
    const [matches, setMatches] = useState<SoccerPostgame[]>([]);
    const [loading, setLoading] = useState(true);
    const [ready, setReady] = useState(false);

    useEffect(() => { setTimeout(() => setReady(true), 50); }, []);
    useEffect(() => {
        fetchRecentMatches(200).then(d => { setMatches(d); setLoading(false); });
        document.title = 'Betting Trends | The Drip';
    }, []);

    const analytics = useMemo(() => {
        if (matches.length === 0) return null;

        // ATS stats
        let homeCovers = 0, awayCovers = 0, pushes = 0, atsTotal = 0;
        let overs = 0, unders = 0, ouPush = 0, ouTotal = 0;
        let favorites = 0, dogs = 0, mlTotal = 0;
        let totalGoals = 0;
        let bigUpsets: SoccerPostgame[] = [];
        let highScoringGames: SoccerPostgame[] = [];

        const leagueMap: Record<string, { matches: number; homeCovers: number; total: number; overs: number; ouTotal: number; avgGoals: number; goals: number }> = {};

        for (const m of matches) {
            const league = m.league_id;
            if (!leagueMap[league]) leagueMap[league] = { matches: 0, homeCovers: 0, total: 0, overs: 0, ouTotal: 0, avgGoals: 0, goals: 0 };
            leagueMap[league].matches++;

            const goals = m.home_score + m.away_score;
            totalGoals += goals;
            leagueMap[league].goals += goals;

            if (goals >= 5) highScoringGames.push(m);

            const spreadRes = getSpreadResult(m);
            if (spreadRes) {
                atsTotal++;
                leagueMap[league].total++;
                if (spreadRes.result === 'covered') { homeCovers++; leagueMap[league].homeCovers++; }
                else if (spreadRes.result === 'failed') awayCovers++;
                else pushes++;
            }

            const totalRes = getTotalResult(m);
            if (totalRes) {
                ouTotal++;
                leagueMap[league].ouTotal++;
                if (totalRes.result === 'over') { overs++; leagueMap[league].overs++; }
                else if (totalRes.result === 'under') unders++;
                else ouPush++;
            }

            const mlRes = getMLResult(m);
            if (m.dk_home_ml != null && m.dk_away_ml != null) {
                mlTotal++;
                const homeIsFav = m.dk_home_ml < m.dk_away_ml;
                const homeWon = m.home_score > m.away_score;
                const awayWon = m.away_score > m.home_score;
                if ((homeIsFav && homeWon) || (!homeIsFav && awayWon)) favorites++;
                if ((homeIsFav && awayWon) || (!homeIsFav && homeWon)) {
                    dogs++;
                    const dogOdds = homeIsFav ? m.dk_away_ml : m.dk_home_ml;
                    if (dogOdds != null && dogOdds >= 200) bigUpsets.push(m);
                }
            }
        }

        bigUpsets.sort((a, b) => {
            const aOdds = Math.max(a.dk_home_ml || 0, a.dk_away_ml || 0);
            const bOdds = Math.max(b.dk_home_ml || 0, b.dk_away_ml || 0);
            return bOdds - aOdds;
        });

        highScoringGames.sort((a, b) => (b.home_score + b.away_score) - (a.home_score + a.away_score));

        const leagueBreakdown = Object.entries(leagueMap).map(([id, d]) => ({
            id, label: LEAGUE_LABELS[id] || id,
            matches: d.matches,
            homeCoverPct: d.total > 0 ? (d.homeCovers / d.total * 100) : 0,
            overPct: d.ouTotal > 0 ? (d.overs / d.ouTotal * 100) : 0,
            avgGoals: d.matches > 0 ? (d.goals / d.matches) : 0,
        })).sort((a, b) => b.matches - a.matches);

        return {
            total: matches.length,
            ats: { homeCovers, awayCovers, pushes, total: atsTotal, homePct: atsTotal ? (homeCovers / atsTotal * 100) : 0 },
            ou: { overs, unders, push: ouPush, total: ouTotal, overPct: ouTotal ? (overs / ouTotal * 100) : 0 },
            ml: { favorites, dogs, total: mlTotal, favPct: mlTotal ? (favorites / mlTotal * 100) : 0 },
            avgGoals: matches.length ? (totalGoals / matches.length) : 0,
            bigUpsets: bigUpsets.slice(0, 5),
            highScoring: highScoringGames.slice(0, 5),
            leagueBreakdown,
        };
    }, [matches]);

    if (loading) return <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.text3, fontFamily: FONT, fontSize: 13, letterSpacing: "0.1em" }}>LOADING TREND ENGINE...</div>;
    if (!analytics) return null;

    return (
        <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: SANS, paddingBottom: 100, opacity: ready ? 1 : 0, transition: "opacity 0.6s ease-out" }}>
            <style>{`
                ::selection { background: ${C.accent}40; color: #fff; }
                .hero-glow { position: fixed; top: 0; left: 0; right: 0; height: 600px; pointer-events: none; overflow: hidden; z-index: 0; }
                .hero-glow::before { content: ''; position: absolute; top: -20%; right: 10%; width: 50%; height: 50%; background: ${C.purple}; opacity: 0.06; filter: blur(120px); border-radius: 50%; }
                .hero-glow::after { content: ''; position: absolute; top: 10%; left: -5%; width: 40%; height: 40%; background: ${C.cyan}; opacity: 0.04; filter: blur(100px); border-radius: 50%; }
                
                .nav-link { font-family: ${FONT}; font-size: 10px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.text2}; text-decoration: none; transition: all 0.2s; padding: 6px 12px; border: 1px solid transparent; border-radius: 6px; }
                .nav-link:hover { color: #fff; background: rgba(255,255,255,0.03); border-color: ${C.border}; }
                
                .metric-card { background: rgba(255,255,255,0.012); border: 1px solid ${C.border}; border-radius: 20px; padding: 32px; transition: all 0.25s cubic-bezier(0.4,0,0.2,1); }
                .metric-card:hover { background: rgba(255,255,255,0.025); border-color: rgba(255,255,255,0.1); transform: translateY(-2px); box-shadow: 0 12px 32px rgba(0,0,0,0.3); }
                
                .bar-track { height: 6px; background: rgba(255,255,255,0.04); border-radius: 3px; overflow: hidden; margin-top: 12px; }
                .bar-fill { height: 100%; border-radius: 3px; transition: width 1.2s cubic-bezier(0.4,0,0.2,1); }
                
                .upset-row { display: grid; grid-template-columns: 1fr 100px 80px; gap: 16px; align-items: center; padding: 16px 20px; background: rgba(255,255,255,0.012); border: 1px solid ${C.border}; border-radius: 12px; text-decoration: none; color: inherit; transition: all 0.2s; }
                .upset-row:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); transform: translateX(3px); }
                
                .league-row { display: grid; grid-template-columns: 1fr 80px 100px 100px 80px; gap: 16px; align-items: center; padding: 16px 24px; border-radius: 12px; transition: background 0.2s; }
                .league-row:hover { background: rgba(255,255,255,0.02); }
                
                @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
            `}</style>

            <div className="hero-glow" />

            {/* Nav */}
            <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,6,6,0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ maxWidth: 1080, margin: "0 auto", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Link to="/" className="nav-link">← Home</Link>
                        <Link to="/reports" className="nav-link">Reports</Link>
                    </div>
                    <span style={{ fontFamily: FONT, fontSize: 10, color: C.text3, letterSpacing: "0.08em" }}>{analytics.total} MATCHES ANALYZED</span>
                </div>
            </div>

            <main style={{ maxWidth: 1080, margin: "0 auto", padding: "60px 24px", position: "relative", zIndex: 10 }}>
                {/* Hero */}
                <header style={{ marginBottom: 72, maxWidth: 800 }}>
                    <h1 style={{ fontFamily: SERIF, fontSize: 56, fontWeight: 400, lineHeight: 1.1, letterSpacing: "-0.02em", margin: "0 0 20px" }}>
                        Betting Trends.<br />
                        <span style={{ color: C.text3 }}>Cross-league market intelligence.</span>
                    </h1>
                    <p style={{ fontSize: 18, color: C.text2, lineHeight: 1.6, maxWidth: 600 }}>
                        Aggregated ATS cover rates, Over/Under splits, favorite vs. underdog performance,
                        and the biggest upsets—computed from real DraftKings closing lines.
                    </p>
                </header>

                {/* KPI Row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 64 }}>
                    {[
                        { val: `${analytics.ats.homePct.toFixed(1)}%`, label: "Home Cover Rate", sub: `${analytics.ats.homeCovers}/${analytics.ats.total} matches`, color: analytics.ats.homePct > 50 ? C.green : C.red, pct: analytics.ats.homePct },
                        { val: `${analytics.ou.overPct.toFixed(1)}%`, label: "Overs Hit Rate", sub: `${analytics.ou.overs}/${analytics.ou.total} totals`, color: analytics.ou.overPct > 50 ? C.amber : C.cyan, pct: analytics.ou.overPct },
                        { val: `${analytics.ml.favPct.toFixed(1)}%`, label: "Favorites Win Rate", sub: `${analytics.ml.favorites}/${analytics.ml.total} MLs`, color: C.purple, pct: analytics.ml.favPct },
                        { val: analytics.avgGoals.toFixed(2), label: "Avg Goals / Match", sub: `across ${analytics.total} games`, color: C.text, pct: (analytics.avgGoals / 5) * 100 },
                    ].map((kpi, i) => (
                        <div key={i} className="metric-card" style={{ animation: `fadeUp 0.4s ease ${i * 0.08}s both` }}>
                            <div style={{ fontFamily: SERIF, fontSize: 42, fontWeight: 400, color: kpi.color, letterSpacing: "-0.03em", lineHeight: 1 }}>{kpi.val}</div>
                            <div style={{ fontFamily: SANS, fontSize: 13, color: C.text2, marginTop: 12, fontWeight: 600 }}>{kpi.label}</div>
                            <div style={{ fontFamily: FONT, fontSize: 11, color: C.text3, marginTop: 4 }}>{kpi.sub}</div>
                            <div className="bar-track">
                                <div className="bar-fill" style={{ width: `${Math.min(kpi.pct, 100)}%`, background: kpi.color }} />
                            </div>
                        </div>
                    ))}
                </div>

                {/* League Breakdown */}
                <section style={{ marginBottom: 64 }}>
                    <h2 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, marginBottom: 24, borderBottom: `1px solid ${C.border}`, paddingBottom: 16 }}>
                        League Breakdown <span style={{ color: C.text3 }}>• By the Numbers</span>
                    </h2>
                    <div style={{ padding: "0 24px", fontSize: 10, color: C.text3, letterSpacing: "0.1em", textTransform: "uppercase", display: "grid", gridTemplateColumns: "1fr 80px 100px 100px 80px", gap: 16, marginBottom: 8, fontFamily: FONT }}>
                        <span>League</span><span>Matches</span><span>Home Cover %</span><span>Over %</span><span>Avg Goals</span>
                    </div>
                    {analytics.leagueBreakdown.map((l, i) => (
                        <Link to={`/reports`} key={l.id} className="league-row" style={{ textDecoration: "none", color: "inherit", animation: `fadeUp 0.3s ease ${i * 0.05}s both` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <span style={{ fontFamily: FONT, fontSize: 10, color: C.text3, width: 32, textAlign: "right" }}>{LEAGUE_SHORT[l.id] || l.id}</span>
                                <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 16 }}>{l.label}</span>
                            </div>
                            <span style={{ fontFamily: FONT, fontSize: 14, color: C.text2, textAlign: "center" }}>{l.matches}</span>
                            <span style={{ fontFamily: FONT, fontSize: 14, color: l.homeCoverPct > 52 ? C.green : l.homeCoverPct < 48 ? C.red : C.text, textAlign: "center", fontWeight: 600 }}>{l.homeCoverPct.toFixed(1)}%</span>
                            <span style={{ fontFamily: FONT, fontSize: 14, color: l.overPct > 52 ? C.amber : C.text, textAlign: "center" }}>{l.overPct.toFixed(1)}%</span>
                            <span style={{ fontFamily: FONT, fontSize: 14, color: C.text2, textAlign: "center" }}>{l.avgGoals.toFixed(2)}</span>
                        </Link>
                    ))}
                </section>

                {/* Two Column: Upsets + High Scoring */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginBottom: 64 }}>
                    {/* Biggest Upsets */}
                    <section>
                        <h2 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, marginBottom: 20, color: C.red }}>
                            Biggest Upsets
                        </h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {analytics.bigUpsets.map((m, i) => {
                                const homeIsFav = (m.dk_home_ml ?? 0) < (m.dk_away_ml ?? 0);
                                const dogTeam = homeIsFav ? m.away_team : m.home_team;
                                const dogOdds = homeIsFav ? m.dk_away_ml : m.dk_home_ml;
                                return (
                                    <Link to={matchUrl(m.home_team, m.away_team, m.start_time)} key={m.id} className="upset-row" style={{ animation: `fadeUp 0.3s ease ${i * 0.06}s both` }}>
                                        <div>
                                            <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 15 }}>{dogTeam} <span style={{ color: C.text3, fontSize: 12 }}>upset</span></div>
                                            <div style={{ fontFamily: FONT, fontSize: 11, color: C.text3, marginTop: 2 }}>{m.home_team} {m.home_score}-{m.away_score} {m.away_team}</div>
                                        </div>
                                        <div style={{ fontFamily: SERIF, fontSize: 22, color: C.red, textAlign: "right" }}>{m.home_score}-{m.away_score}</div>
                                        <div style={{ fontFamily: FONT, fontSize: 14, color: C.green, textAlign: "right", fontWeight: 600 }}>{fmtOdds(dogOdds!)}</div>
                                    </Link>
                                );
                            })}
                        </div>
                    </section>

                    {/* High Scoring */}
                    <section>
                        <h2 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, marginBottom: 20, color: C.amber }}>
                            Highest Scoring
                        </h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {analytics.highScoring.map((m, i) => {
                                const total = m.home_score + m.away_score;
                                return (
                                    <Link to={matchUrl(m.home_team, m.away_team, m.start_time)} key={m.id} className="upset-row" style={{ animation: `fadeUp 0.3s ease ${i * 0.06}s both` }}>
                                        <div>
                                            <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 15 }}>{m.home_team} vs {m.away_team}</div>
                                            <div style={{ fontFamily: FONT, fontSize: 11, color: C.text3, marginTop: 2 }}>{LEAGUE_SHORT[m.league_id] || m.league_id} • {formatMatchDate(m.start_time)}</div>
                                        </div>
                                        <div style={{ fontFamily: SERIF, fontSize: 22, color: C.amber, textAlign: "right" }}>{m.home_score}-{m.away_score}</div>
                                        <div style={{ fontFamily: FONT, fontSize: 13, color: C.text3, textAlign: "right" }}>{total} goals</div>
                                    </Link>
                                );
                            })}
                        </div>
                    </section>
                </div>

                {/* ATS Distribution Visual */}
                <section style={{ marginBottom: 64 }}>
                    <h2 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, marginBottom: 24, borderBottom: `1px solid ${C.border}`, paddingBottom: 16 }}>
                        Market Distribution <span style={{ color: C.text3 }}>• ATS & O/U Splits</span>
                    </h2>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
                        {/* ATS Split */}
                        <div className="metric-card">
                            <div style={{ fontFamily: FONT, fontSize: 11, color: C.text3, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 20 }}>Against The Spread</div>
                            <div style={{ display: "flex", gap: 0, height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 20 }}>
                                <div style={{ width: `${analytics.ats.homePct}%`, background: C.green, transition: "width 1s ease" }} />
                                <div style={{ width: `${100 - analytics.ats.homePct - (analytics.ats.total > 0 ? analytics.ats.pushes / analytics.ats.total * 100 : 0)}%`, background: C.red, transition: "width 1s ease" }} />
                                <div style={{ flex: 1, background: C.text3 }} />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontFamily: FONT }}>
                                <span style={{ color: C.green }}>Home {analytics.ats.homeCovers}</span>
                                <span style={{ color: C.red }}>Away {analytics.ats.awayCovers}</span>
                                <span style={{ color: C.text3 }}>Push {analytics.ats.pushes}</span>
                            </div>
                        </div>

                        {/* O/U Split */}
                        <div className="metric-card">
                            <div style={{ fontFamily: FONT, fontSize: 11, color: C.text3, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 20 }}>Over / Under Totals</div>
                            <div style={{ display: "flex", gap: 0, height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 20 }}>
                                <div style={{ width: `${analytics.ou.overPct}%`, background: C.amber, transition: "width 1s ease" }} />
                                <div style={{ width: `${100 - analytics.ou.overPct - (analytics.ou.total > 0 ? analytics.ou.push / analytics.ou.total * 100 : 0)}%`, background: C.cyan, transition: "width 1s ease" }} />
                                <div style={{ flex: 1, background: C.text3 }} />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontFamily: FONT }}>
                                <span style={{ color: C.amber }}>Over {analytics.ou.overs}</span>
                                <span style={{ color: C.cyan }}>Under {analytics.ou.unders}</span>
                                <span style={{ color: C.text3 }}>Push {analytics.ou.push}</span>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}

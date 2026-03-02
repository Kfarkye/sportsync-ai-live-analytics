import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    SoccerPostgame,
    fetchLeagueMatches,
    fetchTeamsInLeague,
    computeTeamRecord,
    getSpreadResult,
    TeamRecord
} from '../lib/postgame';
import { matchUrl, teamUrl, formatMatchDate, LEAGUE_LABELS } from '../lib/slugs';

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

export default function ReportsPage() {
    const [leagueId, setLeagueId] = useState<string>('epl');
    const [view, setView] = useState<'MATCHES' | 'TEAMS'>('MATCHES');
    const [matches, setMatches] = useState<SoccerPostgame[]>([]);
    const [teams, setTeams] = useState<{ name: string; record: TeamRecord; coverPct: number }[]>([]);
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => { setTimeout(() => setReady(true), 50); }, []);

    useEffect(() => {
        async function init() {
            setLoading(true);
            const lMatches = await fetchLeagueMatches(leagueId);
            setMatches(lMatches);

            if (view === 'TEAMS') {
                const tNames = await fetchTeamsInLeague(leagueId);
                const tRecords = tNames.map(name => {
                    const rec = computeTeamRecord(lMatches, name);
                    const totalAts = rec.ats.covered + rec.ats.failed;
                    const coverPct = totalAts > 0 ? (rec.ats.covered / totalAts) * 100 : 0;
                    return { name, record: rec, coverPct };
                });

                tRecords.sort((a, b) => b.coverPct - a.coverPct);
                setTeams(tRecords);
            }
            setLoading(false);

            document.title = `Reports | ${LEAGUE_LABELS[leagueId]} | The Drip`;
        }
        init();
    }, [leagueId, view]);

    return (
        <div style={{
            backgroundColor: C.bg, color: C.text, minHeight: '100vh', fontFamily: SANS, paddingBottom: 100,
            opacity: ready ? 1 : 0, transition: "opacity 0.6s ease-out"
        }}>
            <style>{`
                ::selection { background: ${C.accent}40; color: #fff; }
                .hero-glow { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
                .hero-glow::before { content: ''; position: absolute; top: -10%; left: 0%; width: 60%; height: 60%; background: ${C.accent}; opacity: 0.04; filter: blur(120px); border-radius: 50%; }
                
                .nav-link { font-family: ${FONT}; font-size: 10px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.text2}; text-decoration: none; transition: color 0.2s; padding: 6px 12px; border: 1px solid transparent; border-radius: 6px; }
                .nav-link:hover { color: #fff; background: rgba(255,255,255,0.03); border-color: ${C.border}; }
                
                .filter-btn { all: unset; cursor: pointer; padding: 10px 18px; border-radius: 8px; font-family: ${FONT}; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; transition: all 0.2s ease; border: 1px solid transparent; }
                .filter-btn[data-active="false"] { color: ${C.text3}; }
                .filter-btn[data-active="false"]:hover { color: ${C.text2}; background: rgba(255,255,255,0.02); }
                .filter-btn[data-active="true"] { color: #fff; background: rgba(255,255,255,0.06); border-color: ${C.border}; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
                
                .view-toggle { display: flex; background: rgba(255,255,255,0.02); padding: 4px; border-radius: 10px; border: 1px solid ${C.border}; }
                .view-btn { all: unset; cursor: pointer; padding: 8px 24px; border-radius: 6px; font-family: ${SANS}; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; transition: all 0.2s ease; }
                .view-btn[data-active="false"] { color: ${C.text3}; }
                .view-btn[data-active="true"] { color: ${C.bg}; background: ${C.text}; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
                
                .match-card { background: rgba(255,255,255,0.012); border: 1px solid ${C.border}; border-radius: 16px; padding: 24px; text-decoration: none; color: inherit; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; gap: 16px; }
                .match-card:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); transform: translateY(-3px); box-shadow: 0 12px 24px rgba(0,0,0,0.3); }
                
                .team-rank-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap: 16px; alignItems: center; padding: 20px 24px; background: rgba(255,255,255,0.015); border: 1px solid ${C.border}; border-radius: 16px; text-decoration: none; color: inherit; transition: all 0.2s; font-family: ${FONT}; }
                .team-rank-row:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); transform: translateX(4px); box-shadow: 0 8px 16px rgba(0,0,0,0.2); }
                
                .data-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; font-family: ${FONT}; font-size: 10px; font-weight: 600; letter-spacing: 0.05em; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.05); }
                .data-pill.success { background: ${C.green}15; border-color: ${C.green}30; color: ${C.green}; }
            `}</style>

            <div className="hero-glow" />

            {/* Global Header */}
            <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,6,6,0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ maxWidth: 1080, margin: "0 auto", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Link to="/" className="nav-link">← Home</Link>
                        <Link to="/trends" className="nav-link">Trends ⇾</Link>
                    </div>
                </div>
            </div>

            <main style={{ maxWidth: 1080, margin: '0 auto', padding: '60px 24px', position: "relative", zIndex: 10 }}>
                {/* HEADER */}
                <header style={{ marginBottom: 64 }}>
                    <h1 style={{ fontFamily: SERIF, fontSize: 56, fontWeight: 400, margin: '0 0 16px', letterSpacing: '-0.02em', color: '#fff', lineHeight: 1.1 }}>
                        Intelligence Reports
                    </h1>
                    <p style={{ fontSize: 18, color: C.text2, margin: 0, maxWidth: 640, lineHeight: 1.6 }}>
                        Automated Postgame Pipelines & ATS Dashboards mapping the live edge of European football betting markets.
                    </p>
                </header>

                {/* FILTERS OVERLAY */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40, flexWrap: "wrap", gap: 20 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: "wrap" }}>
                        {['epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'mls'].map(l => (
                            <button
                                key={l}
                                onClick={() => setLeagueId(l)}
                                className="filter-btn"
                                data-active={leagueId === l}
                            >
                                {l}
                            </button>
                        ))}
                    </div>

                    <div className="view-toggle">
                        {['MATCHES', 'TEAMS'].map(v => (
                            <button
                                key={v}
                                onClick={() => setView(v as any)}
                                className="view-btn"
                                data-active={view === v}
                            >
                                {v === 'MATCHES' ? 'Recent Matches' : 'ATS Standings'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* CONTENT */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: "80px 0", color: C.text3, fontFamily: FONT, fontSize: 13, letterSpacing: "0.1em" }}>LOADING {leagueId.toUpperCase()}...</div>
                ) : (
                    view === 'MATCHES' ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
                            {matches.map(m => {
                                const spreadRes = getSpreadResult(m);
                                return (
                                    <Link to={matchUrl(m.home_team, m.away_team, m.start_time)} key={m.id} className="match-card">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: C.text3, fontFamily: FONT, letterSpacing: "0.05em" }}>
                                            <span>{formatMatchDate(m.start_time)}</span>
                                            {m.dk_home_ml && <span className="data-pill success">ODDS ✓</span>}
                                        </div>
                                        <div style={{ borderLeft: `2px solid ${C.border}`, paddingLeft: 16 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                                <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 18, color: m.home_score > m.away_score ? "#fff" : C.text2 }}>{m.home_team}</span>
                                                <span style={{ fontSize: 28, fontFamily: SERIF, color: m.home_score > m.away_score ? "#fff" : C.text2, lineHeight: 1 }}>{m.home_score}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 18, color: m.away_score > m.home_score ? "#fff" : C.text2 }}>{m.away_team}</span>
                                                <span style={{ fontSize: 28, fontFamily: SERIF, color: m.away_score > m.home_score ? "#fff" : C.text2, lineHeight: 1 }}>{m.away_score}</span>
                                            </div>
                                        </div>
                                        {spreadRes && (
                                            <div style={{ paddingTop: 16, marginTop: 'auto', borderTop: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT, color: C.text2, display: "flex", justifyContent: "space-between" }}>
                                                <span>Closing Spread</span>
                                                <span style={{ color: spreadRes.result === 'covered' ? C.green : spreadRes.result === 'failed' ? C.amber : C.text, fontWeight: 600 }}>
                                                    {spreadRes.result === 'covered' ? 'Home Cover' : spreadRes.result === 'failed' ? 'Away Cover' : 'Push'}
                                                </span>
                                            </div>
                                        )}
                                    </Link>
                                )
                            })}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ padding: '0 24px', fontSize: 11, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 16, marginBottom: 4, fontFamily: FONT }}>
                                <span>Syndicate</span>
                                <span>ATS Record</span>
                                <span>Cover Rate</span>
                                <span>O/U Splits</span>
                                <span>W-D-L</span>
                            </div>
                            {teams.map((t, idx) => (
                                <Link to={teamUrl(t.name)} key={t.name} className="team-rank-row">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                        <span style={{ fontSize: 13, color: C.text3, width: 24, textAlign: "right" }}>{String(idx + 1).padStart(2, '0')}</span>
                                        <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 18, color: "#fff" }}>{t.name}</span>
                                    </div>
                                    <div style={{ color: C.text, fontWeight: 500, fontSize: 14 }}>
                                        <span style={{ color: C.green }}>{t.record.ats.covered}</span>-{t.record.ats.failed}-{t.record.ats.push}
                                    </div>
                                    <div style={{ fontWeight: 600, fontSize: 14, color: t.coverPct >= 55 ? C.green : t.coverPct < 45 ? C.red : C.text }}>{t.coverPct.toFixed(1)}%</div>
                                    <div style={{ fontSize: 14, color: C.text2 }}>{t.record.ou.over}-{t.record.ou.under}-{t.record.ou.push}</div>
                                    <div style={{ fontSize: 14, color: C.text2 }}>{t.record.wins}-{t.record.draws}-{t.record.losses}</div>
                                </Link>
                            ))}
                            <div style={{ textAlign: 'center', padding: '32px 0', color: C.text3, fontSize: 11, fontFamily: FONT, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                                Ranked by Against The Spread • {LEAGUE_LABELS[leagueId]} Selection
                            </div>
                        </div>
                    )
                )}
            </main>
        </div>
    );
}

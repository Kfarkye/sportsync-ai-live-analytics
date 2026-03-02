import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
    SoccerPostgame,
    fetchLeagueMatches,
    fetchTeamsInLeague,
    computeTeamRecord,
    getSpreadResult,
    getTotalResult,
    impliedProb,
    fmtOdds,
    TeamRecord
} from '../lib/postgame';
import { matchUrl, teamUrl, formatMatchDate, LEAGUE_LABELS } from '../lib/slugs';

const FONT = `'JetBrains Mono', 'Fira Code', monospace`;
const SANS = `'SF Pro Display', -apple-system, 'Helvetica Neue', sans-serif`;
const SERIF = `'Newsreader', Georgia, serif`;

const C = {
    bg: "#060606", surface: "#0C0C0C", border: "rgba(255,255,255,0.06)",
    text: "#F0F0F0", text2: "#9A9A9A", text3: "#555",
    green: "#10B981", red: "#EF4444", amber: "#F59E0B", accent: "#3B82F6",
};

const LEAGUES = [
    { id: 'epl', label: 'Premier League' },
    { id: 'laliga', label: 'La Liga' },
    { id: 'seriea', label: 'Serie A' },
    { id: 'bundesliga', label: 'Bundesliga' },
    { id: 'ligue1', label: 'Ligue 1' },
    { id: 'mls', label: 'MLS' },
];

export default function ReportsPage() {
    const [leagueId, setLeagueId] = useState('epl');
    const [view, setView] = useState<'results' | 'standings'>('results');
    const [matches, setMatches] = useState<SoccerPostgame[]>([]);
    const [teams, setTeams] = useState<{ name: string; record: TeamRecord; coverPct: number }[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        async function load() {
            setLoading(true);
            const m = await fetchLeagueMatches(leagueId);
            setMatches(m);
            if (view === 'standings') {
                const names = await fetchTeamsInLeague(leagueId);
                const recs = names.map(name => {
                    const rec = computeTeamRecord(m, name);
                    const total = rec.ats.covered + rec.ats.failed;
                    return { name, record: rec, coverPct: total > 0 ? (rec.ats.covered / total) * 100 : 0 };
                }).sort((a, b) => b.coverPct - a.coverPct);
                setTeams(recs);
            }
            setLoading(false);
            document.title = `${LEAGUE_LABELS[leagueId]} Results | The Drip`;
        }
        load();
    }, [leagueId, view]);

    // Derive league-level stats
    const leagueStats = useMemo(() => {
        if (!matches.length) return null;
        let homeWins = 0, draws = 0, awayWins = 0, totalGoals = 0, gamesWithOdds = 0;
        let homeCovers = 0, atsTotal = 0, overs = 0, ouTotal = 0;
        for (const m of matches) {
            totalGoals += m.home_score + m.away_score;
            if (m.home_score > m.away_score) homeWins++;
            else if (m.home_score === m.away_score) draws++;
            else awayWins++;
            if (m.dk_home_ml != null) gamesWithOdds++;
            const s = getSpreadResult(m);
            if (s) { atsTotal++; if (s.result === 'covered') homeCovers++; }
            const t = getTotalResult(m);
            if (t) { ouTotal++; if (t.result === 'over') overs++; }
        }
        return {
            total: matches.length, homeWins, draws, awayWins, totalGoals,
            avgGoals: (totalGoals / matches.length).toFixed(2),
            gamesWithOdds,
            homeCoverPct: atsTotal > 0 ? (homeCovers / atsTotal * 100).toFixed(1) : '—',
            overPct: ouTotal > 0 ? (overs / ouTotal * 100).toFixed(1) : '—',
        };
    }, [matches]);

    const leagueLabel = LEAGUES.find(l => l.id === leagueId)?.label || leagueId;

    return (
        <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: SANS }}>
            <style>{`
                * { box-sizing: border-box; }
                ::selection { background: rgba(59,130,246,0.3); }
                .sticky-nav { position: sticky; top: 0; z-index: 50; background: rgba(6,6,6,0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-bottom: 1px solid ${C.border}; }
                .pill { display: inline-block; padding: 8px 16px; border-radius: 8px; font-family: ${SANS}; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; background: transparent; color: ${C.text3}; }
                .pill:hover { color: ${C.text2}; background: rgba(255,255,255,0.03); }
                .pill[data-on="true"] { color: #fff; background: rgba(255,255,255,0.07); border-color: ${C.border}; }
                .toggle { display: flex; background: rgba(255,255,255,0.03); padding: 3px; border-radius: 10px; border: 1px solid ${C.border}; }
                .toggle button { all: unset; cursor: pointer; padding: 8px 20px; border-radius: 7px; font-size: 13px; font-weight: 600; color: ${C.text3}; transition: all 0.15s; }
                .toggle button[data-on="true"] { color: ${C.bg}; background: ${C.text}; }
                .match-card { display: flex; flex-direction: column; gap: 14px; padding: 24px; background: rgba(255,255,255,0.015); border: 1px solid ${C.border}; border-radius: 16px; text-decoration: none; color: inherit; transition: all 0.2s ease; }
                .match-card:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.1); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
                .rank-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap: 16px; align-items: center; padding: 18px 24px; background: rgba(255,255,255,0.015); border: 1px solid ${C.border}; border-radius: 14px; text-decoration: none; color: inherit; transition: all 0.15s; }
                .rank-row:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); }
                .kpi { padding: 20px; background: rgba(255,255,255,0.015); border: 1px solid ${C.border}; border-radius: 14px; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
            `}</style>

            {/* Nav */}
            <div className="sticky-nav">
                <div style={{ maxWidth: 1080, margin: "0 auto", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Link to="/" style={{ fontFamily: FONT, fontSize: 10, color: C.text3, textDecoration: "none", padding: "4px 10px", border: `1px solid ${C.border}`, borderRadius: 6, letterSpacing: "0.06em" }}>← HOME</Link>
                        <Link to="/trends" style={{ fontFamily: FONT, fontSize: 10, color: C.text3, textDecoration: "none", padding: "4px 10px", border: `1px solid ${C.border}`, borderRadius: 6, letterSpacing: "0.06em" }}>TRENDS</Link>
                    </div>
                </div>
            </div>

            <main style={{ maxWidth: 1080, margin: "0 auto", padding: "48px 24px 100px" }}>
                {/* Header */}
                <header style={{ marginBottom: 48 }}>
                    <h1 style={{ fontFamily: SERIF, fontSize: 44, fontWeight: 400, margin: "0 0 8px", letterSpacing: "-0.02em", lineHeight: 1.15 }}>{leagueLabel}</h1>
                    <p style={{ fontSize: 16, color: C.text2, margin: 0, lineHeight: 1.5 }}>Season results, closing lines, and ATS performance.</p>
                </header>

                {/* Controls */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32, flexWrap: "wrap", gap: 16 }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {LEAGUES.map(l => (
                            <button key={l.id} className="pill" data-on={leagueId === l.id} onClick={() => setLeagueId(l.id)}>{l.label}</button>
                        ))}
                    </div>
                    <div className="toggle">
                        <button data-on={view === 'results'} onClick={() => setView('results')}>Results</button>
                        <button data-on={view === 'standings'} onClick={() => setView('standings')}>ATS Standings</button>
                    </div>
                </div>

                {/* League KPI bar */}
                {leagueStats && !loading && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 32, animation: "fadeIn 0.3s ease" }}>
                        {[
                            { val: String(leagueStats.total), label: "Matches" },
                            { val: leagueStats.avgGoals, label: "Goals / Match" },
                            { val: `${leagueStats.homeWins}-${leagueStats.draws}-${leagueStats.awayWins}`, label: "H-D-A Record" },
                            { val: `${leagueStats.homeCoverPct}%`, label: "Home Cover %" },
                            { val: `${leagueStats.overPct}%`, label: "Overs Hit %" },
                        ].map((k, i) => (
                            <div key={i} className="kpi">
                                <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 400, color: "#fff", lineHeight: 1, marginBottom: 6 }}>{k.val}</div>
                                <div style={{ fontFamily: FONT, fontSize: 10, color: C.text3, letterSpacing: "0.05em" }}>{k.label}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Content */}
                {loading ? (
                    <div style={{ textAlign: "center", padding: "80px 0", color: C.text3, fontFamily: FONT, fontSize: 12 }}>Loading...</div>
                ) : view === 'results' ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                        {matches.map((m, i) => {
                            const sr = getSpreadResult(m);
                            const tr = getTotalResult(m);
                            return (
                                <Link to={matchUrl(m.home_team, m.away_team, m.start_time)} key={m.id} className="match-card" style={{ animation: `fadeIn 0.25s ease ${Math.min(i * 0.02, 0.4)}s both` }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.text3, fontFamily: FONT }}>
                                        <span>{formatMatchDate(m.start_time)}</span>
                                        {m.dk_home_ml != null && <span style={{ color: C.green, fontSize: 9, fontWeight: 600 }}>LINES</span>}
                                    </div>
                                    <div>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                            <span style={{ fontWeight: 600, fontSize: 16, color: m.home_score >= m.away_score ? "#fff" : C.text2 }}>{m.home_team}</span>
                                            <span style={{ fontFamily: SERIF, fontSize: 24, color: m.home_score > m.away_score ? "#fff" : C.text2 }}>{m.home_score}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <span style={{ fontWeight: 600, fontSize: 16, color: m.away_score > m.home_score ? "#fff" : C.text2 }}>{m.away_team}</span>
                                            <span style={{ fontFamily: SERIF, fontSize: 24, color: m.away_score > m.home_score ? "#fff" : C.text2 }}>{m.away_score}</span>
                                        </div>
                                    </div>
                                    {(sr || tr) && (
                                        <div style={{ display: "flex", gap: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 11, fontFamily: FONT, color: C.text3 }}>
                                            {sr && <span>ATS: <span style={{ color: sr.result === 'covered' ? C.green : sr.result === 'failed' ? C.red : C.text3, fontWeight: 600 }}>{sr.result === 'covered' ? 'Home ✓' : sr.result === 'failed' ? 'Away ✓' : 'Push'}</span></span>}
                                            {tr && <span>Total: <span style={{ color: tr.result === 'over' ? C.amber : C.text2, fontWeight: 500 }}>{tr.result.charAt(0).toUpperCase() + tr.result.slice(1)} ({tr.actual})</span></span>}
                                        </div>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 16, padding: "0 24px", fontSize: 10, color: C.text3, fontFamily: FONT, letterSpacing: "0.06em", marginBottom: 4 }}>
                            <span>Team</span><span>ATS</span><span>Cover %</span><span>O/U</span><span>W-D-L</span>
                        </div>
                        {teams.map((t, i) => (
                            <Link to={teamUrl(t.name)} key={t.name} className="rank-row" style={{ animation: `fadeIn 0.2s ease ${i * 0.03}s both` }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    <span style={{ fontFamily: FONT, fontSize: 12, color: C.text3, width: 20, textAlign: "right" }}>{i + 1}</span>
                                    <span style={{ fontWeight: 600, fontSize: 15 }}>{t.name}</span>
                                </div>
                                <span style={{ fontFamily: FONT, fontSize: 13 }}><span style={{ color: C.green }}>{t.record.ats.covered}</span>-{t.record.ats.failed}-{t.record.ats.push}</span>
                                <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: t.coverPct >= 55 ? C.green : t.coverPct < 45 ? C.red : C.text }}>{t.coverPct.toFixed(1)}%</span>
                                <span style={{ fontFamily: FONT, fontSize: 13, color: C.text2 }}>{t.record.ou.over}-{t.record.ou.under}-{t.record.ou.push}</span>
                                <span style={{ fontFamily: FONT, fontSize: 13, color: C.text2 }}>{t.record.wins}-{t.record.draws}-{t.record.losses}</span>
                            </Link>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

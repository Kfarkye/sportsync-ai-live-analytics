import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    SoccerPostgame,
    fetchLeagueMatches,
    fetchTeamsInLeague,
    computeTeamRecord,
    getSpreadResult,
    getTotalResult,
    TeamRecord,
} from '../lib/postgame';
import { matchUrl, teamUrl, formatMatchDate, LEAGUE_LABELS } from '../lib/slugs';

const FONT = `'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
const SANS = `'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif`;
const SERIF = `'Newsreader', Georgia, 'Times New Roman', serif`;

const C = {
    bg: '#060606',
    surface: '#0C0C0C',
    border: 'rgba(255,255,255,0.06)',
    text: '#F0F0F0',
    text2: '#9A9A9A',
    text3: '#555',
    green: '#10B981',
    red: '#EF4444',
    amber: '#F59E0B',
    accent: '#3B82F6',
};

const LEAGUES = [
    { id: 'epl', label: 'Premier League' },
    { id: 'laliga', label: 'La Liga' },
    { id: 'seriea', label: 'Serie A' },
    { id: 'bundesliga', label: 'Bundesliga' },
    { id: 'ligue1', label: 'Ligue 1' },
    { id: 'mls', label: 'MLS' },
] as const;

type ViewMode = 'results' | 'standings';

export default function ReportsPage() {
    const [leagueId, setLeagueId] = useState<(typeof LEAGUES)[number]['id']>('epl');
    const [view, setView] = useState<ViewMode>('results');
    const [matches, setMatches] = useState<SoccerPostgame[]>([]);
    const [teams, setTeams] = useState<Array<{ name: string; record: TeamRecord; coverPct: number }>>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let alive = true;

        async function load() {
            setLoading(true);

            try {
                const m = await fetchLeagueMatches(leagueId);
                if (!alive) return;

                setMatches(m);

                if (view === 'standings') {
                    const names = await fetchTeamsInLeague(leagueId);
                    if (!alive) return;

                    const recs = names
                        .map((name) => {
                            const rec = computeTeamRecord(m, name);
                            const total = rec.ats.covered + rec.ats.failed;
                            return {
                                name,
                                record: rec,
                                coverPct: total > 0 ? (rec.ats.covered / total) * 100 : 0,
                            };
                        })
                        .sort((a, b) => b.coverPct - a.coverPct);

                    setTeams(recs);
                } else {
                    setTeams([]);
                }

                document.title = `${LEAGUE_LABELS[leagueId] ?? leagueId} Results | The Drip`;
            } finally {
                if (alive) setLoading(false);
            }
        }

        void load();
        return () => {
            alive = false;
        };
    }, [leagueId, view]);

    const leagueStats = useMemo(() => {
        if (!matches.length) return null;

        let homeWins = 0;
        let draws = 0;
        let awayWins = 0;
        let totalGoals = 0;
        let gamesWithOdds = 0;

        let homeCovers = 0;
        let atsTotal = 0;

        let overs = 0;
        let ouTotal = 0;

        for (const m of matches) {
            totalGoals += m.home_score + m.away_score;

            if (m.home_score > m.away_score) homeWins++;
            else if (m.home_score === m.away_score) draws++;
            else awayWins++;

            if (m.dk_home_ml != null) gamesWithOdds++;

            const s = getSpreadResult(m);
            if (s) {
                atsTotal++;
                if (s.result === 'covered') homeCovers++;
            }

            const t = getTotalResult(m);
            if (t) {
                ouTotal++;
                if (t.result === 'over') overs++;
            }
        }

        const avgGoals = totalGoals / matches.length;
        const homeCoverPct = atsTotal > 0 ? (homeCovers / atsTotal) * 100 : null;
        const overPct = ouTotal > 0 ? (overs / ouTotal) * 100 : null;

        return {
            total: matches.length,
            homeWins,
            draws,
            awayWins,
            totalGoals,
            avgGoals: avgGoals.toFixed(2),
            gamesWithOdds,
            homeCoverPct: homeCoverPct == null ? '—' : homeCoverPct.toFixed(1),
            overPct: overPct == null ? '—' : overPct.toFixed(1),
        };
    }, [matches]);

    const leagueLabel = LEAGUES.find((l) => l.id === leagueId)?.label ?? leagueId;

    return (
        <div className="rp-page" style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: SANS }}>
            <style>{`
        * { box-sizing: border-box; }
        ::selection { background: rgba(59,130,246,0.30); }

        .rp-page {
          --pad: clamp(16px, 3.6vw, 24px);
          --section: clamp(20px, 4.2vw, 40px);
          --container: 1120px;
        }

        .rp-container { max-width: var(--container); margin: 0 auto; padding-left: var(--pad); padding-right: var(--pad); }

        .rp-sticky {
          position: sticky;
          top: 0;
          z-index: 50;
          background: rgba(6,6,6,0.86);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid ${C.border};
        }

        .rp-navRow {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 0;
        }

        .rp-navLinks { display: flex; align-items: center; gap: 10px; }

        .rp-chipLink {
          font-family: ${FONT};
          font-size: 10px;
          color: ${C.text3};
          text-decoration: none;
          padding: 6px 10px;
          border: 1px solid ${C.border};
          border-radius: 8px;
          letter-spacing: 0.06em;
          line-height: 1;
          transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
        }
        .rp-chipLink:hover { color: ${C.text2}; background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.10); }
        .rp-chipLink:focus-visible { outline: 2px solid rgba(59,130,246,0.55); outline-offset: 2px; }

        .rp-main { padding-top: clamp(30px, 5vw, 56px); padding-bottom: 100px; }

        .rp-header { margin-bottom: var(--section); }
        .rp-title {
          font-family: ${SERIF};
          font-size: clamp(34px, 4.2vw, 46px);
          font-weight: 400;
          margin: 0 0 10px;
          letter-spacing: -0.02em;
          line-height: 1.12;
        }
        .rp-subtitle { font-size: 16px; color: ${C.text2}; margin: 0; line-height: 1.55; }

        .rp-controls {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }
        .rp-pills { display: flex; gap: 6px; flex-wrap: wrap; }

        .pill {
          display: inline-block;
          padding: 8px 14px;
          border-radius: 10px;
          font-family: ${SANS};
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 120ms ease;
          background: transparent;
          color: ${C.text3};
          line-height: 1;
        }
        .pill:hover { color: ${C.text2}; background: rgba(255,255,255,0.03); }
        .pill:active { transform: translateY(1px); }
        .pill:focus-visible { outline: 2px solid rgba(59,130,246,0.55); outline-offset: 2px; }
        .pill[data-on="true"] { color: #fff; background: rgba(255,255,255,0.07); border-color: ${C.border}; }

        .toggle { display: flex; background: rgba(255,255,255,0.03); padding: 3px; border-radius: 12px; border: 1px solid ${C.border}; }
        .toggle button { all: unset; cursor: pointer; padding: 8px 18px; border-radius: 9px; font-size: 13px; font-weight: 600; color: ${C.text3}; transition: background 150ms ease, color 150ms ease; line-height: 1; }
        .toggle button[data-on="true"] { color: ${C.bg}; background: ${C.text}; }
        .toggle button:focus-visible { outline: 2px solid rgba(59,130,246,0.55); outline-offset: 2px; }

        .kpiGrid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px;
          margin-top: 10px;
          margin-bottom: 28px;
          animation: fadeIn 240ms ease;
        }
        @media (max-width: 980px) { .kpiGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 640px) { .kpiGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 22px; } }

        .kpi { padding: 18px; background: rgba(255,255,255,0.015); border: 1px solid ${C.border}; border-radius: 14px; }
        .kpiVal { font-family: ${SERIF}; font-size: 24px; font-weight: 400; color: #fff; line-height: 1; margin-bottom: 8px; }
        .kpiLab { font-family: ${FONT}; font-size: 10px; color: ${C.text3}; letter-spacing: 0.06em; }

        .rp-loading { text-align: center; padding: 84px 0; color: ${C.text3}; font-family: ${FONT}; font-size: 12px; }

        .resultsGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
        @media (max-width: 360px) { .resultsGrid { grid-template-columns: 1fr; } }

        .match-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 22px;
          background: rgba(255,255,255,0.015);
          border: 1px solid ${C.border};
          border-radius: 16px;
          text-decoration: none;
          color: inherit;
          transition: transform 180ms ease, background 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
          will-change: transform;
        }
        .match-card:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.10); transform: translateY(-2px); box-shadow: 0 10px 26px rgba(0,0,0,0.32); }
        @media (max-width: 520px) { .match-card { padding: 18px; } }

        .metaRow { display: flex; justify-content: space-between; font-size: 11px; color: ${C.text3}; font-family: ${FONT}; }
        .linesBadge { color: ${C.green}; font-size: 9px; font-weight: 700; letter-spacing: 0.08em; }

        .teamRow { display: flex; justify-content: space-between; align-items: center; }
        .teamName { font-weight: 650; font-size: 16px; }
        .score { font-family: ${SERIF}; font-size: 24px; }

        .resultStrip {
          display: flex;
          gap: 12px;
          padding-top: 12px;
          border-top: 1px solid ${C.border};
          font-size: 11px;
          font-family: ${FONT};
          color: ${C.text3};
          flex-wrap: wrap;
          row-gap: 8px;
        }

        .standingsWrap { display: flex; flex-direction: column; gap: 10px; }

        .tableScroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          padding-bottom: 2px;
        }
        .tableInner { min-width: 860px; }

        .standingsHead {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
          gap: 16px;
          padding: 0 24px;
          font-size: 10px;
          color: ${C.text3};
          font-family: ${FONT};
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }

        .rank-row {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
          gap: 16px;
          align-items: center;
          padding: 18px 24px;
          background: rgba(255,255,255,0.015);
          border: 1px solid ${C.border};
          border-radius: 14px;
          text-decoration: none;
          color: inherit;
          transition: background 150ms ease, border-color 150ms ease;
        }
        .rank-row:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

            {/* Nav */}
            <div className="rp-sticky">
                <div className="rp-container">
                    <div className="rp-navRow">
                        <div className="rp-navLinks">
                            <Link className="rp-chipLink" to="/">
                                ← HOME
                            </Link>
                            <Link className="rp-chipLink" to="/trends">
                                TRENDS
                            </Link>
                        </div>
                        <div />
                    </div>
                </div>
            </div>

            <main className="rp-container rp-main">
                {/* Header */}
                <header className="rp-header">
                    <h1 className="rp-title">{leagueLabel}</h1>
                    <p className="rp-subtitle">Season results, closing lines, and ATS performance.</p>
                </header>

                {/* Controls */}
                <div className="rp-controls">
                    <div className="rp-pills">
                        {LEAGUES.map((l) => (
                            <button
                                key={l.id}
                                className="pill"
                                data-on={leagueId === l.id}
                                onClick={() => setLeagueId(l.id)}
                            >
                                {l.label}
                            </button>
                        ))}
                    </div>

                    <div className="toggle" role="tablist" aria-label="Reports view">
                        <button data-on={view === 'results'} onClick={() => setView('results')} role="tab" aria-selected={view === 'results'}>
                            Results
                        </button>
                        <button
                            data-on={view === 'standings'}
                            onClick={() => setView('standings')}
                            role="tab"
                            aria-selected={view === 'standings'}
                        >
                            ATS Standings
                        </button>
                    </div>
                </div>

                {/* League KPI bar */}
                {leagueStats && !loading && (
                    <div className="kpiGrid">
                        {[
                            { val: String(leagueStats.total), label: 'Matches' },
                            { val: leagueStats.avgGoals, label: 'Goals / Match' },
                            { val: `${leagueStats.homeWins}-${leagueStats.draws}-${leagueStats.awayWins}`, label: 'H-D-A Record' },
                            { val: leagueStats.homeCoverPct === '—' ? '—' : `${leagueStats.homeCoverPct}%`, label: 'Home Cover %' },
                            { val: leagueStats.overPct === '—' ? '—' : `${leagueStats.overPct}%`, label: 'Overs Hit %' },
                        ].map((k, i) => (
                            <div key={i} className="kpi">
                                <div className="kpiVal">{k.val}</div>
                                <div className="kpiLab">{k.label}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Content */}
                {loading ? (
                    <div className="rp-loading">Loading...</div>
                ) : view === 'results' ? (
                    <div className="resultsGrid">
                        {matches.map((m, i) => {
                            const sr = getSpreadResult(m);
                            const tr = getTotalResult(m);

                            return (
                                <Link
                                    to={matchUrl(m.home_team, m.away_team, m.start_time)}
                                    key={m.id}
                                    className="match-card"
                                    style={{ animation: `fadeIn 220ms ease ${Math.min(i * 0.02, 0.35)}s both` }}
                                >
                                    <div className="metaRow">
                                        <span>{formatMatchDate(m.start_time)}</span>
                                        {m.dk_home_ml != null && <span className="linesBadge">LINES</span>}
                                    </div>

                                    <div>
                                        <div className="teamRow" style={{ marginBottom: 8 }}>
                                            <span className="teamName" style={{ color: m.home_score >= m.away_score ? '#fff' : C.text2 }}>
                                                {m.home_team}
                                            </span>
                                            <span className="score" style={{ color: m.home_score > m.away_score ? '#fff' : C.text2 }}>
                                                {m.home_score}
                                            </span>
                                        </div>

                                        <div className="teamRow">
                                            <span className="teamName" style={{ color: m.away_score > m.home_score ? '#fff' : C.text2 }}>
                                                {m.away_team}
                                            </span>
                                            <span className="score" style={{ color: m.away_score > m.home_score ? '#fff' : C.text2 }}>
                                                {m.away_score}
                                            </span>
                                        </div>
                                    </div>

                                    {(sr || tr) && (
                                        <div className="resultStrip">
                                            {sr && (
                                                <span>
                                                    ATS:{' '}
                                                    <span
                                                        style={{
                                                            color: sr.result === 'covered' ? C.green : sr.result === 'failed' ? C.red : C.text3,
                                                            fontWeight: 700,
                                                        }}
                                                    >
                                                        {sr.result === 'covered' ? 'Home ✓' : sr.result === 'failed' ? 'Away ✓' : 'Push'}
                                                    </span>
                                                </span>
                                            )}

                                            {tr && (
                                                <span>
                                                    Total:{' '}
                                                    <span style={{ color: tr.result === 'over' ? C.amber : C.text2, fontWeight: 600 }}>
                                                        {tr.result.charAt(0).toUpperCase() + tr.result.slice(1)} ({tr.actual})
                                                    </span>
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                ) : (
                    <div className="standingsWrap">
                        <div className="tableScroll">
                            <div className="tableInner">
                                <div className="standingsHead">
                                    <span>Team</span>
                                    <span>ATS</span>
                                    <span>Cover %</span>
                                    <span>O/U</span>
                                    <span>W-D-L</span>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {teams.map((t, i) => (
                                        <Link
                                            to={teamUrl(t.name)}
                                            key={t.name}
                                            className="rank-row"
                                            style={{ animation: `fadeIn 200ms ease ${Math.min(i * 0.03, 0.45)}s both` }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <span style={{ fontFamily: FONT, fontSize: 12, color: C.text3, width: 20, textAlign: 'right' }}>
                                                    {i + 1}
                                                </span>
                                                <span style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</span>
                                            </div>

                                            <span style={{ fontFamily: FONT, fontSize: 13 }}>
                                                <span style={{ color: C.green }}>{t.record.ats.covered}</span>-{t.record.ats.failed}-{t.record.ats.push}
                                            </span>

                                            <span
                                                style={{
                                                    fontFamily: FONT,
                                                    fontSize: 13,
                                                    fontWeight: 800,
                                                    color: t.coverPct >= 55 ? C.green : t.coverPct < 45 ? C.red : C.text,
                                                }}
                                            >
                                                {t.coverPct.toFixed(1)}%
                                            </span>

                                            <span style={{ fontFamily: FONT, fontSize: 13, color: C.text2 }}>
                                                {t.record.ou.over}-{t.record.ou.under}-{t.record.ou.push}
                                            </span>

                                            <span style={{ fontFamily: FONT, fontSize: 13, color: C.text2 }}>
                                                {t.record.wins}-{t.record.draws}-{t.record.losses}
                                            </span>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

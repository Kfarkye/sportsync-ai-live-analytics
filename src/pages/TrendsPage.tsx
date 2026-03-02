import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    SoccerPostgame,
    fetchRecentMatches,
    getSpreadResult,
    getTotalResult,
    fmtOdds,
} from '../lib/postgame';
import { matchUrl, formatMatchDate, LEAGUE_LABELS, LEAGUE_SHORT } from '../lib/slugs';

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
    purple: '#8B5CF6',
    cyan: '#06B6D4',
};

type LeagueAgg = { n: number; hc: number; at: number; ov: number; ot: number; g: number };

export default function TrendsPage() {
    const [matches, setMatches] = useState<SoccerPostgame[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;

        (async () => {
            try {
                const d = await fetchRecentMatches(200);
                if (!alive) return;
                setMatches(d);
            } finally {
                if (alive) setLoading(false);
            }
        })();

        document.title = 'Betting Trends | The Drip';
        return () => {
            alive = false;
        };
    }, []);

    const data = useMemo(() => {
        if (!matches.length) return null;

        let homeCovers = 0;
        let awayCovers = 0;
        let pushes = 0;
        let atsTotal = 0;

        let overs = 0;
        let unders = 0;
        let ouPush = 0;
        let ouTotal = 0;

        let favWins = 0;
        let dogWins = 0;
        let mlTotal = 0;

        let totalGoals = 0;

        const upsets: SoccerPostgame[] = [];
        const highScoring: SoccerPostgame[] = [];

        const byLeague: Record<string, LeagueAgg> = {};

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
                atsTotal++;
                byLeague[lid].at++;
                if (sr.result === 'covered') {
                    homeCovers++;
                    byLeague[lid].hc++;
                } else if (sr.result === 'failed') {
                    awayCovers++;
                } else {
                    pushes++;
                }
            }

            const tr = getTotalResult(m);
            if (tr) {
                ouTotal++;
                byLeague[lid].ot++;
                if (tr.result === 'over') {
                    overs++;
                    byLeague[lid].ov++;
                } else if (tr.result === 'under') {
                    unders++;
                } else {
                    ouPush++;
                }
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

        upsets.sort(
            (a, b) =>
                Math.max(b.dk_home_ml || 0, b.dk_away_ml || 0) - Math.max(a.dk_home_ml || 0, a.dk_away_ml || 0),
        );
        highScoring.sort((a, b) => b.home_score + b.away_score - (a.home_score + a.away_score));

        const leagues = Object.entries(byLeague)
            .map(([id, d]) => ({
                id,
                label: LEAGUE_LABELS[id] || id,
                short: LEAGUE_SHORT[id] || id,
                n: d.n,
                hcPct: d.at > 0 ? (d.hc / d.at) * 100 : 0,
                ovPct: d.ot > 0 ? (d.ov / d.ot) * 100 : 0,
                avgG: d.n > 0 ? d.g / d.n : 0,
            }))
            .sort((a, b) => b.n - a.n);

        const avgGoals = totalGoals / matches.length;

        const homePct = atsTotal ? (homeCovers / atsTotal) * 100 : 0;
        const awayPct = atsTotal ? (awayCovers / atsTotal) * 100 : 0;
        const pushPctATS = atsTotal ? (pushes / atsTotal) * 100 : 0;

        const overPct = ouTotal ? (overs / ouTotal) * 100 : 0;
        const underPct = ouTotal ? (unders / ouTotal) * 100 : 0;
        const pushPctOU = ouTotal ? (ouPush / ouTotal) * 100 : 0;

        const favPct = mlTotal ? (favWins / mlTotal) * 100 : 0;

        return {
            total: matches.length,
            avgGoals: avgGoals.toFixed(2),
            ats: {
                homeCovers,
                awayCovers,
                pushes,
                total: atsTotal,
                pct: homePct,
                split: { homePct, awayPct, pushPct: pushPctATS },
            },
            ou: {
                overs,
                unders,
                push: ouPush,
                total: ouTotal,
                pct: overPct,
                split: { overPct, underPct, pushPct: pushPctOU },
            },
            ml: { favWins, dogWins, total: mlTotal, pct: favPct },
            upsets: upsets.slice(0, 6),
            highScoring: highScoring.slice(0, 6),
            leagues,
        };
    }, [matches]);

    if (loading) {
        return (
            <div
                style={{
                    background: C.bg,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: C.text3,
                    fontFamily: FONT,
                    fontSize: 12,
                }}
            >
                Loading...
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="tp-page" style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: SANS }}>
            <style>{`
        * { box-sizing: border-box; }
        ::selection { background: rgba(59,130,246,0.30); }

        .tp-page {
          --pad: clamp(16px, 3.6vw, 24px);
          --section: clamp(20px, 4.2vw, 42px);
          --container: 1120px;
        }

        .tp-container { max-width: var(--container); margin: 0 auto; padding-left: var(--pad); padding-right: var(--pad); }

        .tp-sticky {
          position: sticky;
          top: 0;
          z-index: 50;
          background: rgba(6,6,6,0.86);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid ${C.border};
        }

        .tp-navRow { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; }
        .tp-navLinks { display: flex; align-items: center; gap: 10px; }

        .tp-chipLink {
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
        .tp-chipLink:hover { color: ${C.text2}; background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.10); }
        .tp-chipLink:focus-visible { outline: 2px solid rgba(59,130,246,0.55); outline-offset: 2px; }

        .tp-main { padding-top: clamp(30px, 5vw, 56px); padding-bottom: 100px; }

        .tp-header { margin-bottom: var(--section); }
        .tp-title {
          font-family: ${SERIF};
          font-size: clamp(34px, 4.2vw, 46px);
          font-weight: 400;
          margin: 0 0 10px;
          letter-spacing: -0.02em;
          line-height: 1.12;
        }
        .tp-subtitle { font-size: 16px; color: ${C.text2}; margin: 0; line-height: 1.55; }

        .tp-meta { font-family: ${FONT}; font-size: 10px; color: ${C.text3}; letter-spacing: 0.06em; }

        .kpi {
          padding: 20px;
          background: rgba(255,255,255,0.015);
          border: 1px solid ${C.border};
          border-radius: 16px;
          transition: background 180ms ease, border-color 180ms ease;
        }
        .kpi:hover { background: rgba(255,255,255,0.025); border-color: rgba(255,255,255,0.09); }

        .kpiGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: var(--section);
        }
        @media (max-width: 980px) { .kpiGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 560px) { .kpiGrid { grid-template-columns: 1fr; gap: 12px; } }

        .kpiVal { font-family: ${SERIF}; font-size: 36px; font-weight: 400; line-height: 1; }
        .kpiLabel { font-size: 13px; color: ${C.text2}; margin-top: 10px; font-weight: 600; }
        .kpiSub { font-family: ${FONT}; font-size: 10px; color: ${C.text3}; margin-top: 3px; }

        .bar-track { height: 5px; background: rgba(255,255,255,0.04); border-radius: 3px; overflow: hidden; margin-top: 14px; }
        .bar-fill { height: 100%; border-radius: 3px; transition: width 900ms cubic-bezier(0.4,0,0.2,1); }

        .tp-section { margin-bottom: var(--section); }
        .tp-h2 {
          font-family: ${SERIF};
          font-size: 28px;
          font-weight: 400;
          margin: 0 0 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid ${C.border};
        }

        .tableScroll { overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
        .tableInner { min-width: 820px; }

        .lg-head {
          padding: 0 20px;
          display: grid;
          grid-template-columns: 1fr 60px 80px 80px 70px;
          gap: 12px;
          font-size: 10px;
          color: ${C.text3};
          font-family: ${FONT};
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }
        .lg-row {
          display: grid;
          grid-template-columns: 1fr 60px 80px 80px 70px;
          gap: 12px;
          align-items: center;
          padding: 14px 20px;
          border-radius: 12px;
          transition: background 150ms ease, border-color 150ms ease;
          border: 1px solid transparent;
        }
        .lg-row:hover { background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.05); }

        .tp-twoCol {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: var(--section);
        }
        @media (max-width: 900px) { .tp-twoCol { grid-template-columns: 1fr; gap: 14px; } }

        .split-bar { display: flex; gap: 0; height: 6px; border-radius: 3px; overflow: hidden; }

        .tp-cards {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
        }
        @media (max-width: 980px) { .tp-cards { grid-template-columns: 1fr; gap: 20px; } }

        .rows { display: flex; flex-direction: column; gap: 10px; }

        .game-row {
          display: grid;
          grid-template-columns: 1fr 88px 76px;
          gap: 12px;
          align-items: center;
          padding: 14px 18px;
          background: rgba(255,255,255,0.012);
          border: 1px solid ${C.border};
          border-radius: 12px;
          text-decoration: none;
          color: inherit;
          transition: background 150ms ease, border-color 150ms ease, transform 150ms ease;
        }
        .game-row:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); transform: translateY(-1px); }
        .game-row:focus-visible { outline: 2px solid rgba(59,130,246,0.55); outline-offset: 2px; }

        .gr-main { min-width: 0; }
        .gr-score { font-family: ${SERIF}; font-size: 18px; text-align: right; color: ${C.text2}; white-space: nowrap; }
        .gr-right { font-family: ${FONT}; font-size: 13px; text-align: right; white-space: nowrap; }

        @media (max-width: 560px) {
          .game-row {
            grid-template-columns: 1fr auto;
            grid-template-areas:
              "main main"
              "score right";
            row-gap: 10px;
            padding: 14px 16px;
          }
          .gr-main { grid-area: main; }
          .gr-score { grid-area: score; text-align: left; font-size: 16px; }
          .gr-right { grid-area: right; }
        }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

            {/* Nav */}
            <div className="tp-sticky">
                <div className="tp-container">
                    <div className="tp-navRow">
                        <div className="tp-navLinks">
                            <Link to="/" className="tp-chipLink">
                                ← HOME
                            </Link>
                            <Link to="/reports" className="tp-chipLink">
                                REPORTS
                            </Link>
                        </div>
                        <span className="tp-meta">{data.total} matches</span>
                    </div>
                </div>
            </div>

            <main className="tp-container tp-main">
                <header className="tp-header">
                    <h1 className="tp-title">Betting Trends</h1>
                    <p className="tp-subtitle">Cross-league cover rates, totals, and market outcomes from DraftKings closing lines.</p>
                </header>

                {/* KPIs */}
                <div className="kpiGrid">
                    {[
                        {
                            val: `${data.ats.pct.toFixed(1)}%`,
                            label: 'Home Cover Rate',
                            sub: `${data.ats.homeCovers} of ${data.ats.total}`,
                            color: data.ats.pct >= 50 ? C.green : C.red,
                            pct: data.ats.pct,
                        },
                        {
                            val: `${data.ou.pct.toFixed(1)}%`,
                            label: 'Overs Rate',
                            sub: `${data.ou.overs} of ${data.ou.total}`,
                            color: data.ou.pct >= 50 ? C.amber : C.cyan,
                            pct: data.ou.pct,
                        },
                        {
                            val: `${data.ml.pct.toFixed(1)}%`,
                            label: 'Favorites Win',
                            sub: `${data.ml.favWins} of ${data.ml.total}`,
                            color: C.accent,
                            pct: data.ml.pct,
                        },
                        {
                            val: data.avgGoals,
                            label: 'Avg Goals',
                            sub: `${data.total} matches`,
                            color: C.text,
                            pct: Math.min((parseFloat(data.avgGoals) / 5) * 100, 100),
                        },
                    ].map((k, i) => (
                        <div key={i} className="kpi" style={{ animation: `fadeIn 260ms ease ${i * 0.06}s both` }}>
                            <div className="kpiVal" style={{ color: k.color }}>
                                {k.val}
                            </div>
                            <div className="kpiLabel">{k.label}</div>
                            <div className="kpiSub">{k.sub}</div>
                            <div className="bar-track">
                                <div className="bar-fill" style={{ width: `${Math.min(k.pct, 100)}%`, background: k.color }} />
                            </div>
                        </div>
                    ))}
                </div>

                {/* By League */}
                <section className="tp-section">
                    <h2 className="tp-h2">By League</h2>
                    <div className="tableScroll">
                        <div className="tableInner">
                            <div className="lg-head">
                                <span>League</span>
                                <span style={{ textAlign: 'center' }}>Games</span>
                                <span style={{ textAlign: 'center' }}>Home ATS</span>
                                <span style={{ textAlign: 'center' }}>Over %</span>
                                <span style={{ textAlign: 'center' }}>Goals</span>
                            </div>

                            {data.leagues.map((l, i) => (
                                <div key={l.id} className="lg-row" style={{ animation: `fadeIn 200ms ease ${i * 0.035}s both` }}>
                                    <span style={{ fontWeight: 700, fontSize: 15 }}>{l.label}</span>
                                    <span style={{ fontFamily: FONT, fontSize: 13, color: C.text2, textAlign: 'center' }}>{l.n}</span>
                                    <span
                                        style={{
                                            fontFamily: FONT,
                                            fontSize: 13,
                                            color: l.hcPct > 52 ? C.green : l.hcPct < 48 ? C.red : C.text,
                                            textAlign: 'center',
                                            fontWeight: 700,
                                        }}
                                    >
                                        {l.hcPct.toFixed(1)}%
                                    </span>
                                    <span style={{ fontFamily: FONT, fontSize: 13, color: l.ovPct > 52 ? C.amber : C.text, textAlign: 'center' }}>
                                        {l.ovPct.toFixed(1)}%
                                    </span>
                                    <span style={{ fontFamily: FONT, fontSize: 13, color: C.text2, textAlign: 'center' }}>{l.avgG.toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ATS / OU Splits */}
                <div className="tp-twoCol">
                    <div className="kpi">
                        <div style={{ fontFamily: FONT, fontSize: 10, color: C.text3, letterSpacing: '0.08em', marginBottom: 16 }}>ATS SPLIT</div>
                        <div className="split-bar" style={{ marginBottom: 16 }}>
                            <div style={{ width: `${data.ats.split.homePct}%`, background: C.green }} />
                            <div style={{ width: `${data.ats.split.awayPct}%`, background: C.red }} />
                            <div style={{ width: `${data.ats.split.pushPct}%`, background: C.text3 }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontFamily: FONT }}>
                            <span style={{ color: C.green }}>Home {data.ats.homeCovers}</span>
                            <span style={{ color: C.red }}>Away {data.ats.awayCovers}</span>
                            <span style={{ color: C.text3 }}>Push {data.ats.pushes}</span>
                        </div>
                    </div>

                    <div className="kpi">
                        <div style={{ fontFamily: FONT, fontSize: 10, color: C.text3, letterSpacing: '0.08em', marginBottom: 16 }}>O/U SPLIT</div>
                        <div className="split-bar" style={{ marginBottom: 16 }}>
                            <div style={{ width: `${data.ou.split.overPct}%`, background: C.amber }} />
                            <div style={{ width: `${data.ou.split.underPct}%`, background: C.cyan }} />
                            <div style={{ width: `${data.ou.split.pushPct}%`, background: C.text3 }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontFamily: FONT }}>
                            <span style={{ color: C.amber }}>Over {data.ou.overs}</span>
                            <span style={{ color: C.cyan }}>Under {data.ou.unders}</span>
                            <span style={{ color: C.text3 }}>Push {data.ou.push}</span>
                        </div>
                    </div>
                </div>

                {/* Upsets + High Scoring */}
                <div className="tp-cards">
                    <section className="tp-section" style={{ marginBottom: 0 }}>
                        <h2 className="tp-h2">Biggest Upsets</h2>
                        <div className="rows">
                            {data.upsets.map((m, i) => {
                                const hFav = (m.dk_home_ml ?? 0) < (m.dk_away_ml ?? 0);
                                const dog = hFav ? m.away_team : m.home_team;
                                const line = hFav ? m.dk_away_ml : m.dk_home_ml;

                                return (
                                    <Link
                                        to={matchUrl(m.home_team, m.away_team, m.start_time)}
                                        key={m.id}
                                        className="game-row"
                                        style={{ animation: `fadeIn 200ms ease ${i * 0.04}s both` }}
                                    >
                                        <div className="gr-main">
                                            <div style={{ fontWeight: 700, fontSize: 14 }}>{dog}</div>
                                            <div style={{ fontFamily: FONT, fontSize: 10, color: C.text3, marginTop: 3 }}>
                                                {LEAGUE_SHORT[m.league_id]} · {formatMatchDate(m.start_time)}
                                            </div>
                                        </div>

                                        <div className="gr-score">{m.home_score}-{m.away_score}</div>

                                        <div className="gr-right" style={{ color: C.green, fontWeight: 800 }}>
                                            {line == null ? '—' : fmtOdds(line)}
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    </section>

                    <section className="tp-section" style={{ marginBottom: 0 }}>
                        <h2 className="tp-h2">Highest Scoring</h2>
                        <div className="rows">
                            {data.highScoring.map((m, i) => (
                                <Link
                                    to={matchUrl(m.home_team, m.away_team, m.start_time)}
                                    key={m.id}
                                    className="game-row"
                                    style={{ animation: `fadeIn 200ms ease ${i * 0.04}s both` }}
                                >
                                    <div className="gr-main">
                                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                                            {m.home_team} vs {m.away_team}
                                        </div>
                                        <div style={{ fontFamily: FONT, fontSize: 10, color: C.text3, marginTop: 3 }}>
                                            {LEAGUE_SHORT[m.league_id]} · {formatMatchDate(m.start_time)}
                                        </div>
                                    </div>

                                    <div className="gr-score" style={{ color: C.amber }}>
                                        {m.home_score}-{m.away_score}
                                    </div>

                                    <div className="gr-right" style={{ color: C.text3, fontSize: 12 }}>
                                        {m.home_score + m.away_score} goals
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

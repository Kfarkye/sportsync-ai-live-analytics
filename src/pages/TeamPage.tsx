import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    SoccerPostgame,
    fetchTeamMatches,
    computeTeamRecord,
    fetchTeamMeta,
    TeamRecord,
    getSpreadResult,
    getTotalResult,
} from '../lib/postgame';
import { formatMatchDate, matchUrl } from '../lib/slugs';

const FONT = `'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
const SANS = `'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif`;
const SERIF = `'Newsreader', Georgia, 'Times New Roman', serif`;

const C = {
    bg: '#060606',
    surface: '#0D0D0D',
    surface2: '#141414',
    border: 'rgba(255,255,255,0.06)',
    text: '#F8F8F8',
    text2: '#A0A0A0',
    text3: '#666666',
    accent: '#3B82F6',
    green: '#10B981',
    red: '#EF4444',
    amber: '#F59E0B',
    purple: '#8B5CF6',
    cyan: '#06B6D4',
};

function fmtSpread(n: number) {
    if (n > 0) return `+${n}`;
    if (n === 0) return 'PK';
    return String(n);
}

export default function TeamPage() {
    const { slug } = useParams<{ slug: string }>();

    const [matches, setMatches] = useState<SoccerPostgame[]>([]);
    const [meta, setMeta] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [record, setRecord] = useState<TeamRecord | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setReady(true), 50);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        let alive = true;

        async function init() {
            if (!slug) return;

            const teamNameFromSlug = slug.replace(/-/g, ' ');

            const tMeta = await fetchTeamMeta(teamNameFromSlug);
            if (!alive) return;
            setMeta(tMeta);

            const tMatches = await fetchTeamMatches(slug);
            if (!alive) return;
            setMatches(tMatches);

            if (tMeta && tMatches.length > 0) {
                const teamName = tMeta.name || tMeta.short_name || teamNameFromSlug;
                const tRecord = computeTeamRecord(tMatches, teamName);
                setRecord(tRecord);

                const pageTitle = `${teamName} ATS Record & Results | The Drip`;
                document.title = pageTitle;

                const denom = tRecord.ats.covered + tRecord.ats.failed;
                const coverPct = denom > 0 ? ((tRecord.ats.covered / denom) * 100).toFixed(1) : '0.0';
                const desc = `${teamName} ATS record: ${tRecord.ats.covered}-${tRecord.ats.failed}. Cover rate: ${coverPct}%. Full season results with closing lines.`;

                document.querySelector('meta[property="og:title"]')?.setAttribute('content', pageTitle);
                document.querySelector('meta[property="og:description"]')?.setAttribute('content', desc);
            }

            if (alive) setLoading(false);
        }

        void init();
        return () => {
            alive = false;
        };
    }, [slug]);

    if (loading) {
        return (
            <div
                style={{
                    color: C.text3,
                    background: C.bg,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: FONT,
                    fontSize: 13,
                    letterSpacing: '0.1em',
                }}
            >
                Loading...
            </div>
        );
    }

    if (!record || !meta || matches.length === 0) {
        return (
            <div
                style={{
                    color: C.text,
                    background: C.bg,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: SANS,
                }}
            >
                Record not found.
            </div>
        );
    }

    const atsTotal = record.ats.covered + record.ats.failed;
    const coverPct = atsTotal > 0 ? ((record.ats.covered / atsTotal) * 100).toFixed(1) : '0.0';

    const teamName = meta.name || meta.short_name || (slug || '').replace(/-/g, ' ');
    const teamColor = meta.color || C.accent;

    return (
        <div className="tp-page" style={{ backgroundColor: C.bg, color: C.text, minHeight: '100vh', fontFamily: SANS, paddingBottom: 100, opacity: ready ? 1 : 0, transition: 'opacity 0.6s ease-out' }}>
            <style>{`
        * { box-sizing: border-box; }
        ::selection { background: ${teamColor}40; color: #fff; }

        .tp-page {
          --pad: clamp(16px, 3.6vw, 24px);
          --section: clamp(22px, 4.2vw, 56px);
          --container: 1120px;
          --rail: 980px;
        }

        .tp-container { max-width: var(--container); margin: 0 auto; padding-left: var(--pad); padding-right: var(--pad); position: relative; z-index: 10; }

        .hero-glow { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
        .hero-glow::before { content: ''; position: absolute; top: -20%; left: 20%; width: 60%; height: 60%; background: ${teamColor}; opacity: 0.08; filter: blur(140px); border-radius: 50%; }

        .sticky {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(6,6,6,0.82);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid ${C.border};
        }

        .navRow { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; }
        .nav-link {
          font-family: ${FONT};
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: ${C.text2};
          text-decoration: none;
          transition: color 0.2s, background 0.2s, border-color 0.2s;
          padding: 6px 12px;
          border: 1px solid transparent;
          border-radius: 8px;
          line-height: 1;
        }
        .nav-link:hover { color: #fff; background: rgba(255,255,255,0.03); border-color: ${C.border}; }
        .nav-link:focus-visible { outline: 2px solid rgba(59,130,246,0.55); outline-offset: 2px; }

        main.tp-main { padding-top: clamp(34px, 6vw, 64px); padding-bottom: 60px; }

        .hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          margin-bottom: var(--section);
        }

        .logoBox {
          width: clamp(108px, 16vw, 140px);
          height: clamp(108px, 16vw, 140px);
          border-radius: 24px;
          background: rgba(255,255,255,0.03);
          border: 1px solid ${C.border};
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 28px;
          box-shadow: 0 24px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
          transform: rotate(-4deg);
          overflow: hidden;
        }

        .heroTitle {
          margin: 0 0 10px;
          font-size: clamp(40px, 6vw, 64px);
          font-weight: 400;
          font-family: ${SERIF};
          letter-spacing: -0.02em;
          line-height: 1.08;
        }

        .heroKicker {
          font-size: 13px;
          color: ${C.text3};
          font-weight: 700;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          font-family: ${FONT};
        }

        .statRail {
          width: 100%;
          max-width: 920px;
          margin-top: clamp(28px, 5vw, 56px);
          display: grid;
          grid-template-columns: 1fr 1px 1fr;
          gap: clamp(18px, 3vw, 44px);
          align-items: center;
          padding: 0 10px;
        }
        .statDivider { width: 1px; height: 100%; background: ${C.border}; }

        @media (max-width: 720px) {
          .statRail {
            grid-template-columns: 1fr;
            gap: 18px;
          }
          .statDivider { display: none; }
        }

        .statBlock { display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .statLabel { font-size: 11px; color: ${C.text3}; font-weight: 700; letter-spacing: 0.1em; font-family: ${FONT}; }
        .statLine { display: flex; align-items: baseline; gap: 8px; }
        .statMain { font-size: clamp(38px, 5.2vw, 56px); font-family: ${SERIF}; line-height: 1; }
        .statPush { font-size: clamp(18px, 2.6vw, 24px); font-family: ${SERIF}; color: ${C.text3}; }
        .statSub { font-size: 13px; color: ${C.text2}; font-family: ${FONT}; }

        .ledgerWrap { max-width: var(--rail); margin: 0 auto; }

        .ledgerTitle {
          font-size: clamp(24px, 3.2vw, 32px);
          font-family: ${SERIF};
          font-weight: 400;
          margin: 0 0 18px;
          border-bottom: 1px solid ${C.border};
          padding-bottom: 14px;
        }

        .tableScroll { overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
        .tableInner { min-width: 860px; }
        @media (max-width: 980px) { .tableInner { min-width: 860px; } }

        .ledgerHead {
          padding: 0 32px;
          font-size: 11px;
          color: ${C.text3};
          letter-spacing: 0.08em;
          text-transform: uppercase;
          display: grid;
          grid-template-columns: 140px 1fr 120px 180px 140px;
          gap: 20px;
          margin-bottom: 12px;
          font-family: ${FONT};
          opacity: 0.6;
        }

        .match-row {
          display: grid;
          grid-template-columns: 140px 1fr 120px 180px 140px;
          gap: 20px;
          align-items: center;
          padding: 22px 32px;
          background: rgba(255,255,255,0.012);
          border: 1px solid ${C.border};
          border-radius: 16px;
          text-decoration: none;
          color: inherit;
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s, border-color 0.25s, box-shadow 0.25s;
          position: relative;
          overflow: hidden;
        }
        .match-row:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); transform: translateX(4px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
        .match-row::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: transparent; transition: background 0.2s; }

        .match-row-cover { background: rgba(16,185,129,0.02); border-color: rgba(16,185,129,0.15); }
        .match-row-cover::before { background: ${C.green}; }
        .match-row-fail { background: rgba(239,68,68,0.01); }

        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

            <div className="hero-glow" />

            <div className="sticky">
                <div className="tp-container">
                    <div className="navRow">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <Link to="/reports" className="nav-link">
                                ← League Reports
                            </Link>
                        </div>
                        <div />
                    </div>
                </div>
            </div>

            <main className="tp-container tp-main">
                <div className="hero">
                    <div className="logoBox">
                        {meta.logo_url ? (
                            <img src={meta.logo_url} width={100} height={100} style={{ objectFit: 'contain', transform: 'rotate(4deg)' }} />
                        ) : (
                            <div style={{ fontSize: 48, fontWeight: 800, color: teamColor, transform: 'rotate(4deg)' }}>{(teamName || slug || 'T')[0]}</div>
                        )}
                    </div>

                    <h1 className="heroTitle">{teamName}</h1>
                    <div className="heroKicker">{meta.league_id} Season Data</div>

                    <div className="statRail">
                        <div className="statBlock">
                            <div className="statLabel">AGAINST THE SPREAD</div>
                            <div className="statLine">
                                <span className="statMain" style={{ color: Number(coverPct) >= 50 ? C.green : C.text }}>
                                    {record.ats.covered}-{record.ats.failed}
                                </span>
                                <span className="statPush">-{record.ats.push}</span>
                            </div>
                            <div className="statSub">{coverPct}% Cover Rate</div>
                        </div>

                        <div className="statDivider" />

                        <div className="statBlock">
                            <div className="statLabel">OVER / UNDER</div>
                            <div className="statLine">
                                <span className="statMain">
                                    {record.ou.over}-{record.ou.under}
                                </span>
                                <span className="statPush">-{record.ou.push}</span>
                            </div>
                            <div className="statSub">Totals Bias</div>
                        </div>
                    </div>
                </div>

                <div className="ledgerWrap">
                    <div className="ledgerTitle">
                        The Ledger <span style={{ color: C.text3 }}>• Season Results</span>
                    </div>

                    <div className="tableScroll">
                        <div className="tableInner">
                            <div className="ledgerHead">
                                <span>Date</span>
                                <span>Opponent</span>
                                <span>Result</span>
                                <span>Closing Spread</span>
                                <span>Total Result</span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                {matches.map((m, i) => {
                                    const teamLower = String(meta.name || teamName).toLowerCase();
                                    const isHome = String(m.home_team).toLowerCase() === teamLower || String(m.home_team).toLowerCase().includes(teamLower);
                                    const opp = isHome ? m.away_team : m.home_team;

                                    const spreadRes = getSpreadResult(m);
                                    const totalRes = getTotalResult(m);

                                    const didCoverSpread = isHome ? spreadRes?.result === 'covered' : spreadRes?.result === 'failed';
                                    const spreadFailed = isHome ? spreadRes?.result === 'failed' : spreadRes?.result === 'covered';

                                    const rowClass = `match-row ${didCoverSpread ? 'match-row-cover' : spreadFailed ? 'match-row-fail' : ''}`;
                                    const isWin = isHome ? m.home_score > m.away_score : m.away_score > m.home_score;

                                    const spreadForTeam = m.dk_spread != null ? (isHome ? m.dk_spread : -m.dk_spread) : null;

                                    return (
                                        <Link
                                            to={matchUrl(m.home_team, m.away_team, m.start_time)}
                                            key={m.id}
                                            className={rowClass}
                                            style={{ animation: `fadeUp 0.3s ease ${i * 0.05}s both` }}
                                        >
                                            <div style={{ color: C.text3, fontSize: 12, fontFamily: FONT }}>{formatMatchDate(m.start_time)}</div>

                                            <div style={{ fontFamily: SANS, fontWeight: 650, fontSize: 18, color: '#fff' }}>
                                                <span style={{ color: C.text3, marginRight: 8 }}>{isHome ? 'vs' : '@'}</span>
                                                {opp}
                                            </div>

                                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: isWin ? C.accent : C.text3 }} />
                                                <span style={{ fontFamily: SERIF, fontSize: 24, color: '#fff', letterSpacing: '-0.04em' }}>
                                                    {isHome ? `${m.home_score}-${m.away_score}` : `${m.away_score}-${m.home_score}`}
                                                </span>
                                            </div>

                                            <div style={{ fontFamily: FONT }}>
                                                {spreadRes ? (
                                                    <div style={{ color: didCoverSpread ? C.green : spreadFailed ? C.text3 : C.text2, fontSize: 13, fontWeight: 700 }}>
                                                        {spreadForTeam != null ? <span style={{ opacity: 0.6, marginRight: 8 }}>{fmtSpread(spreadForTeam)}</span> : null}
                                                        {didCoverSpread ? 'Covered ✓' : spreadFailed ? 'Failed ✕' : 'Push —'}
                                                    </div>
                                                ) : (
                                                    <span style={{ color: C.text3, fontSize: 12 }}>Off Board</span>
                                                )}
                                            </div>

                                            <div style={{ fontFamily: FONT }}>
                                                {totalRes ? (
                                                    <div style={{ color: totalRes.result === 'over' ? C.text : totalRes.result === 'under' ? C.text2 : C.text3, fontSize: 13, fontWeight: 600 }}>
                                                        {m.dk_total != null ? <span style={{ opacity: 0.6, marginRight: 8 }}>O {m.dk_total}</span> : null}
                                                        {String(totalRes.result).toUpperCase()}
                                                    </div>
                                                ) : (
                                                    <span style={{ color: C.text3, fontSize: 12 }}>Off Board</span>
                                                )}
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

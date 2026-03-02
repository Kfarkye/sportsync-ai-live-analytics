import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    SoccerPostgame,
    fetchTeamMatches,
    computeTeamRecord,
    fetchTeamMeta,
    TeamRecord,
    getSpreadResult,
    getTotalResult,
    getMLResult
} from '../lib/postgame';
import { formatMatchDate, matchUrl } from '../lib/slugs';

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

export default function TeamPage() {
    const { slug } = useParams<{ slug: string }>();

    const [matches, setMatches] = useState<SoccerPostgame[]>([]);
    const [meta, setMeta] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [record, setRecord] = useState<TeamRecord | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => { setTimeout(() => setReady(true), 50); }, []);

    useEffect(() => {
        async function init() {
            if (!slug) return;
            const tMeta = await fetchTeamMeta(slug.replace(/-/g, ' '));
            setMeta(tMeta);

            const tMatches = await fetchTeamMatches(slug);
            setMatches(tMatches);

            if (tMeta && tMatches.length > 0) {
                const teamName = tMeta.name || tMeta.short_name || slug.replace(/-/g, ' ');
                const tRecord = computeTeamRecord(tMatches, teamName);
                setRecord(tRecord);

                const pageTitle = `${teamName} ATS Record & Results | The Drip`;
                document.title = pageTitle;

                const coverPct = ((tRecord.ats.covered / (tRecord.ats.covered + tRecord.ats.failed)) * 100).toFixed(1);
                const desc = `${teamName} ATS record: ${tRecord.ats.covered}-${tRecord.ats.failed}. Cover rate: ${coverPct}%. Full season results with closing lines.`;

                document.querySelector('meta[property="og:title"]')?.setAttribute('content', pageTitle);
                document.querySelector('meta[property="og:description"]')?.setAttribute('content', desc);
            }
            setLoading(false);
        }
        init();
    }, [slug]);

    if (loading) return <div style={{ color: C.text3, background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontSize: 13, letterSpacing: '0.1em' }}>LOADING SYNDICATE...</div>;
    if (!record || !meta || matches.length === 0) return <div style={{ color: C.text, background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SANS }}>Record not found.</div>;

    const atsTotal = record.ats.covered + record.ats.failed;
    const coverPct = atsTotal > 0 ? ((record.ats.covered / atsTotal) * 100).toFixed(1) : '0';

    return (
        <div style={{ backgroundColor: C.bg, color: C.text, minHeight: '100vh', fontFamily: SANS, paddingBottom: 100, opacity: ready ? 1 : 0, transition: "opacity 0.6s ease-out" }}>
            <style>{`
                ::selection { background: ${meta.color || C.accent}40; color: #fff; }
                .hero-glow { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
                .hero-glow::before { content: ''; position: absolute; top: -20%; left: 20%; width: 60%; height: 60%; background: ${meta.color || C.accent}; opacity: 0.08; filter: blur(140px); border-radius: 50%; }
                
                .nav-link { font-family: ${FONT}; font-size: 10px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.text2}; text-decoration: none; transition: color 0.2s; padding: 6px 12px; border: 1px solid transparent; border-radius: 6px; }
                .nav-link:hover { color: #fff; background: rgba(255,255,255,0.03); border-color: ${C.border}; }
                
                .match-row { display: grid; grid-template-columns: 140px 1fr 120px 180px 140px; gap: 20px; alignItems: center; padding: 24px 32px; background: rgba(255,255,255,0.012); border: 1px solid ${C.border}; border-radius: 16px; text-decoration: none; color: inherit; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); position: relative; overflow: hidden; }
                .match-row:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); transform: translateX(4px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
                .match-row::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: transparent; transition: background 0.2s; }
                
                .match-row-cover { background: rgba(16,185,129,0.02); border-color: rgba(16,185,129,0.15); }
                .match-row-cover::before { background: ${C.green}; }
                .match-row-fail { background: rgba(239,68,68,0.01); }
                
                @media (max-width: 900px) {
                    .match-row { grid-template-columns: 1fr; gap: 12px; padding: 20px; }
                }
            `}</style>

            <div className="hero-glow" />

            <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,6,6,0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ maxWidth: 1080, margin: "0 auto", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Link to="/reports" className="nav-link">← League Reports</Link>
                    </div>
                </div>
            </div>

            <main style={{ maxWidth: 1080, margin: '0 auto', padding: '60px 24px', position: "relative", zIndex: 10 }}>
                {/* HERO SECTION */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 80 }}>
                    <div style={{
                        width: 140, height: 140, borderRadius: '24px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 32,
                        boxShadow: `0 24px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)`,
                        transform: 'rotate(-4deg)', overflow: "hidden"
                    }}>
                        {meta.logo_url ? <img src={meta.logo_url} width={100} height={100} style={{ objectFit: 'contain', transform: 'rotate(4deg)' }} /> :
                            <div style={{ fontSize: 48, fontWeight: 'bold', color: meta.color || "#fff", transform: 'rotate(4deg)' }}>{(meta.name || slug)[0]}</div>}
                    </div>

                    <h1 style={{ margin: '0 0 12px', fontSize: 64, fontWeight: 400, fontFamily: SERIF, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{meta.name}</h1>
                    <div style={{ fontSize: 13, color: C.text3, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: FONT }}>{meta.league_id} Syndicate Data</div>

                    <div style={{ display: 'flex', justifyContent: 'center', gap: 64, marginTop: 56, flexWrap: 'wrap', padding: "0 24px" }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                            <div style={{ fontSize: 11, color: C.text3, fontWeight: 600, letterSpacing: '0.1em', fontFamily: FONT }}>AGAINST THE SPREAD</div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                                <span style={{ fontSize: 56, fontFamily: SERIF, color: Number(coverPct) >= 50 ? C.green : C.text, lineHeight: 1 }}>{record.ats.covered}-{record.ats.failed}</span>
                                <span style={{ fontSize: 24, fontFamily: SERIF, color: C.text3 }}>-{record.ats.push}</span>
                            </div>
                            <div style={{ fontSize: 13, color: C.text2, fontFamily: FONT }}>{coverPct}% Cover Rate</div>
                        </div>
                        <div style={{ width: 1, background: C.border }} />
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                            <div style={{ fontSize: 11, color: C.text3, fontWeight: 600, letterSpacing: '0.1em', fontFamily: FONT }}>OVER / UNDER</div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                                <span style={{ fontSize: 56, fontFamily: SERIF, color: C.text, lineHeight: 1 }}>{record.ou.over}-{record.ou.under}</span>
                                <span style={{ fontSize: 24, fontFamily: SERIF, color: C.text3 }}>-{record.ou.push}</span>
                            </div>
                            <div style={{ fontSize: 13, color: C.text2, fontFamily: FONT }}>Totals Bias</div>
                        </div>
                    </div>
                </div>

                {/* MATCH LEDGER */}
                <div style={{ maxWidth: 960, margin: '0 auto' }}>
                    <div style={{ fontSize: 32, fontFamily: SERIF, fontWeight: 400, marginBottom: 32, borderBottom: `1px solid ${C.border}`, paddingBottom: 16 }}>The Ledger <span style={{ color: C.text3 }}>• Season Results</span></div>

                    <div style={{ padding: '0 32px', fontSize: 11, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'grid', gridTemplateColumns: '140px 1fr 120px 180px 140px', gap: 20, marginBottom: 12, fontFamily: FONT, opacity: 0.6 }}>
                        <span>Date</span>
                        <span>Opponent</span>
                        <span>Result</span>
                        <span>Closing Spread</span>
                        <span>Total Result</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {matches.map((m, i) => {
                            const isHome = m.home_team.toLowerCase().includes(meta.name.toLowerCase()) || m.home_team === meta.name;
                            const opp = isHome ? m.away_team : m.home_team;
                            const spreadRes = getSpreadResult(m);
                            const totalRes = getTotalResult(m);

                            const didCoverSpread = isHome ? spreadRes?.result === 'covered' : spreadRes?.result === 'failed';
                            const spreadFailed = isHome ? spreadRes?.result === 'failed' : spreadRes?.result === 'covered';

                            const rowClass = `match-row ${didCoverSpread ? 'match-row-cover' : spreadFailed ? 'match-row-fail' : ''}`;
                            const isWin = isHome ? m.home_score > m.away_score : m.away_score > m.home_score;

                            return (
                                <Link to={matchUrl(m.home_team, m.away_team, m.start_time)} key={m.id} className={rowClass} style={{ animation: `fadeUp 0.3s ease ${i * 0.05}s both` }}>
                                    <div style={{ color: C.text3, fontSize: 12, fontFamily: FONT }}>{formatMatchDate(m.start_time)}</div>
                                    <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 18, color: "#fff" }}>
                                        <span style={{ color: C.text3, marginRight: 8 }}>{isHome ? 'vs' : '@'}</span>
                                        {opp}
                                    </div>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        {isWin ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent }} /> : <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.text3 }} />}
                                        <span style={{ fontFamily: SERIF, fontSize: 24, color: isWin ? "#fff" : C.text, letterSpacing: "-0.04em" }}>
                                            {isHome ? `${m.home_score}-${m.away_score}` : `${m.away_score}-${m.home_score}`}
                                        </span>
                                    </div>
                                    <div style={{ fontFamily: FONT }}>
                                        {spreadRes ? (
                                            <div style={{ color: didCoverSpread ? C.green : spreadFailed ? C.text3 : C.text2, fontSize: 13, fontWeight: 600 }}>
                                                {m.dk_spread != null ? <span style={{ opacity: 0.6, marginRight: 8 }}>{fmtSpread(isHome ? m.dk_spread : -m.dk_spread)}</span> : null}
                                                {didCoverSpread ? 'Covered ✓' : spreadFailed ? 'Failed ✕' : 'Push —'}
                                            </div>
                                        ) : <span style={{ color: C.text3, fontSize: 12 }}>Off Board</span>}
                                    </div>
                                    <div style={{ fontFamily: FONT }}>
                                        {totalRes ? (
                                            <div style={{ color: totalRes.result === 'over' ? C.text : totalRes.result === 'under' ? C.text2 : C.text3, fontSize: 13, fontWeight: 500 }}>
                                                {m.dk_total != null ? <span style={{ opacity: 0.6, marginRight: 8 }}>O {m.dk_total}</span> : null}
                                                {totalRes.result.toUpperCase()}
                                            </div>
                                        ) : <span style={{ color: C.text3, fontSize: 12 }}>Off Board</span>}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </main>
        </div>
    );
}

function fmtSpread(n: number) {
    if (n > 0) return `+${n}`;
    if (n === 0) return 'PK';
    return String(n);
}

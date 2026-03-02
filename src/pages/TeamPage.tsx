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
import { fonts, colors } from '../lib/obsidian';

export default function TeamPage() {
    const { slug } = useParams<{ slug: string }>();

    const [matches, setMatches] = useState<SoccerPostgame[]>([]);
    const [meta, setMeta] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [record, setRecord] = useState<TeamRecord | null>(null);

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

                // SEO Meta Tags
                const pageTitle = `${teamName} 2025-26 | ATS Record, Stats & Results | The Drip`;
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

    if (loading) return <div style={{ color: colors.text.primary, background: colors.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
    if (!record || !meta || matches.length === 0) return <div style={{ color: colors.text.primary, background: colors.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Team data not found.</div>;

    const atsTotal = record.ats.covered + record.ats.failed;
    const coverPct = atsTotal > 0 ? ((record.ats.covered / atsTotal) * 100).toFixed(1) : '0';

    return (
        <div style={{ backgroundColor: colors.bg, color: colors.text.primary, minHeight: '100vh', fontFamily: fonts.sans, paddingBottom: 64 }}>
            {/* HERO SECTION */}
            <div style={{ padding: '64px 20px', borderBottom: `1px solid ${colors.border}`, textAlign: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
                    {meta.logo_url ? <img src={meta.logo_url} width={120} height={120} style={{ objectFit: 'contain' }} /> :
                        <div style={{ width: 120, height: 120, borderRadius: '50%', background: meta.color || colors.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, fontWeight: 'bold' }}>{(meta.name || slug)[0]}</div>}
                    <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700 }}>{meta.name}</h1>
                    <div style={{ fontSize: 16, color: colors.text.secondary, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{meta.league_id}</div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 48, marginTop: 48, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 13, color: colors.text.secondary, fontWeight: 600, letterSpacing: '0.05em' }}>ATS RECORD</div>
                        <div style={{ fontSize: 48, fontFamily: fonts.serif, color: colors.accent.green }}>{record.ats.covered}-{record.ats.failed}-{record.ats.push}</div>
                        <div style={{ fontSize: 14, color: colors.text.secondary }}>{coverPct}% Cover Rate</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 13, color: colors.text.secondary, fontWeight: 600, letterSpacing: '0.05em' }}>O/U RECORD</div>
                        <div style={{ fontSize: 48, fontFamily: fonts.serif }}>{record.ou.over}-{record.ou.under}-{record.ou.push}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 13, color: colors.text.secondary, fontWeight: 600, letterSpacing: '0.05em' }}>W-D-L</div>
                        <div style={{ fontSize: 48, fontFamily: fonts.serif }}>{record.wins}-{record.draws}-{record.losses}</div>
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 20px' }}>
                <div style={{ fontSize: 24, fontFamily: fonts.serif, fontWeight: 'bold', marginBottom: 24 }}>Season Results</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {matches.map(m => {
                        const isHome = m.home_team.toLowerCase().includes(meta.name.toLowerCase()) || m.home_team === meta.name;
                        const opp = isHome ? m.away_team : m.home_team;
                        const spreadRes = getSpreadResult(m);
                        const totalRes = getTotalResult(m);
                        const mlRes = getMLResult(m);

                        const didCoverSpread = isHome ? spreadRes?.result === 'covered' : spreadRes?.result === 'failed';
                        const spreadFailed = isHome ? spreadRes?.result === 'failed' : spreadRes?.result === 'covered';
                        const spreadPush = spreadRes?.result === 'push';

                        const rowBorderColor = didCoverSpread ? colors.accent.greenBorder : spreadFailed ? colors.accent.redBorder : colors.border;
                        const rowBg = didCoverSpread ? colors.accent.greenBg : spreadFailed ? colors.accent.redBg : colors.insight.bg;

                        return (
                            <Link to={matchUrl(m.home_team, m.away_team, m.start_time)} key={m.id} style={{
                                display: 'grid', gridTemplateColumns: '120px 1fr 120px 180px 140px', gap: 16, alignItems: 'center',
                                textDecoration: 'none', color: colors.text.primary,
                                padding: '16px 20px', borderRadius: 12, border: `1px solid ${rowBorderColor}`, background: rowBg,
                                fontFamily: fonts.mono
                            }}>
                                <div style={{ color: colors.text.secondary, fontSize: 14 }}>{formatMatchDate(m.start_time)}</div>
                                <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 16 }}>{isHome ? 'vs' : '@'} {opp}</div>
                                <div>
                                    <span style={{ fontWeight: isHome ? 'bold' : 'normal', color: m.home_score > m.away_score && isHome ? colors.accent.green : colors.text.primary }}>{m.home_score}</span> - <span style={{ fontWeight: !isHome ? 'bold' : 'normal', color: m.away_score > m.home_score && !isHome ? colors.accent.green : colors.text.primary }}>{m.away_score}</span>
                                </div>
                                <div>
                                    {spreadRes ? (
                                        <div style={{ color: didCoverSpread ? colors.accent.green : spreadFailed ? colors.accent.red : colors.text.secondary, fontSize: 14, fontWeight: 500 }}>
                                            ATS: {didCoverSpread ? 'Covered' : spreadFailed ? 'Failed' : 'Push'}
                                        </div>
                                    ) : <span style={{ color: colors.text.tertiary, fontSize: 12 }}>No Line</span>}
                                </div>
                                <div>
                                    {totalRes ? (
                                        <div style={{ color: totalRes.result === 'over' ? colors.text.primary : totalRes.result === 'under' ? colors.text.secondary : colors.text.tertiary, fontSize: 14, fontWeight: 500 }}>
                                            Total: {totalRes.result.toUpperCase()}
                                        </div>
                                    ) : <span style={{ color: colors.text.tertiary, fontSize: 12 }}>-</span>}
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

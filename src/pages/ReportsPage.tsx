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
import { fonts, colors } from '../lib/obsidian';

export default function ReportsPage() {
    const [leagueId, setLeagueId] = useState<string>('epl');
    const [view, setView] = useState<'MATCHES' | 'TEAMS'>('MATCHES');
    const [matches, setMatches] = useState<SoccerPostgame[]>([]);
    const [teams, setTeams] = useState<{ name: string; record: TeamRecord; coverPct: number }[]>([]);
    const [loading, setLoading] = useState(false);

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
        <div style={{ backgroundColor: colors.bg, color: colors.text.primary, minHeight: '100vh', fontFamily: fonts.sans, paddingBottom: 64 }}>
            {/* HEADER */}
            <div style={{ padding: '64px 20px 32px', textAlign: 'center', borderBottom: `1px solid ${colors.border}` }}>
                <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 16px', letterSpacing: '-0.02em' }}>Intelligence Reports</h1>
                <div style={{ fontSize: 16, color: colors.text.secondary }}>Automated Postgame Pipelines & ATS Dashboards</div>
            </div>

            <div style={{ maxWidth: 1000, margin: '32px auto 0', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 32 }}>

                {/* FILTERS */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, background: colors.card, padding: 4, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                        {['epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'mls'].map(l => (
                            <button
                                key={l}
                                onClick={() => setLeagueId(l)}
                                style={{
                                    background: leagueId === l ? colors.text.primary : 'transparent',
                                    color: leagueId === l ? colors.bg : colors.text.secondary,
                                    border: 'none',
                                    padding: '8px 16px',
                                    borderRadius: 6,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    fontFamily: fonts.sans,
                                    textTransform: 'uppercase'
                                }}
                            >
                                {l.toUpperCase()}
                            </button>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: 8, background: colors.card, padding: 4, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                        {['MATCHES', 'TEAMS'].map(v => (
                            <button
                                key={v}
                                onClick={() => setView(v as any)}
                                style={{
                                    background: view === v ? colors.accent.greenBg : 'transparent',
                                    color: view === v ? colors.accent.green : colors.text.secondary,
                                    border: 'none',
                                    padding: '8px 16px',
                                    borderRadius: 6,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    fontFamily: fonts.sans,
                                    letterSpacing: '0.05em'
                                }}
                            >
                                {v}
                            </button>
                        ))}
                    </div>
                </div>

                {/* CONTENT */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 64, color: colors.text.secondary, fontFamily: fonts.mono }}>Loading {leagueId} data...</div>
                ) : (
                    view === 'MATCHES' ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                            {matches.map(m => {
                                const spreadRes = getSpreadResult(m);
                                return (
                                    <Link to={matchUrl(m.home_team, m.away_team, m.start_time)} key={m.id} style={{
                                        background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20,
                                        textDecoration: 'none', color: colors.text.primary, transition: 'all 0.2s', display: 'flex', flexDirection: 'column', gap: 12
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: colors.text.secondary, fontFamily: fonts.mono }}>
                                            <span>{formatMatchDate(m.start_time)}</span>
                                            {m.dk_home_ml && <span style={{ padding: '2px 6px', background: colors.accent.greenBg, color: colors.accent.green, borderRadius: 4, fontWeight: 600 }}>ODDS</span>}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontWeight: 600, fontSize: 16 }}>{m.home_team}</span>
                                            <span style={{ fontSize: 24, fontFamily: fonts.serif }}>{m.home_score}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontWeight: 600, fontSize: 16 }}>{m.away_team}</span>
                                            <span style={{ fontSize: 24, fontFamily: fonts.serif }}>{m.away_score}</span>
                                        </div>
                                        {spreadRes && (
                                            <div style={{ paddingTop: 12, marginTop: 4, borderTop: `1px solid ${colors.border}`, fontSize: 12, color: colors.text.secondary }}>
                                                Spread: <span style={{ color: spreadRes.result === 'covered' ? colors.accent.green : spreadRes.result === 'failed' ? colors.accent.red : colors.text.secondary, fontWeight: 600 }}>
                                                    {spreadRes.result === 'covered' ? 'Home Covered' : spreadRes.result === 'failed' ? 'Away Covered' : 'Push'}
                                                </span>
                                            </div>
                                        )}
                                    </Link>
                                )
                            })}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div style={{ padding: '0 20px', fontSize: 13, color: colors.text.tertiary, letterSpacing: '0.05em', textTransform: 'uppercase', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 16, marginBottom: 8, fontFamily: fonts.mono }}>
                                <span>Team</span>
                                <span>ATS Record</span>
                                <span>Cover %</span>
                                <span>O/U</span>
                                <span>W-D-L</span>
                            </div>
                            {teams.map((t, idx) => (
                                <Link to={teamUrl(t.name)} key={t.name} style={{
                                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 16, alignItems: 'center', padding: '16px 20px',
                                    background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, textDecoration: 'none', color: colors.text.primary,
                                    transition: 'all 0.2s', fontFamily: fonts.mono
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span style={{ fontSize: 12, color: colors.text.tertiary, width: 20 }}>{idx + 1}</span>
                                        <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 16 }}>{t.name}</span>
                                    </div>
                                    <div style={{ color: colors.accent.green, fontWeight: 500 }}>{t.record.ats.covered}-{t.record.ats.failed}-{t.record.ats.push}</div>
                                    <div style={{ fontWeight: 'bold' }}>{t.coverPct.toFixed(1)}%</div>
                                    <div>{t.record.ou.over}-{t.record.ou.under}-{t.record.ou.push}</div>
                                    <div>{t.record.wins}-{t.record.draws}-{t.record.losses}</div>
                                </Link>
                            ))}
                            <div style={{ textAlign: 'center', padding: '16px 0', color: colors.text.secondary, fontSize: 13 }}>Ranked by Against The Spread record • {LEAGUE_LABELS[leagueId]}</div>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

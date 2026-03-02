import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    SoccerPostgame,
    fetchMatchBySlug,
    fetchTeamMeta,
    getSpreadResult,
    getTotalResult,
    getMLResult,
    impliedProb,
    fmtOdds,
} from '../lib/postgame';
import { parseMatchSlug, LEAGUE_SHORT, LEAGUE_LABELS, teamUrl } from '../lib/slugs';

function parseMinute(raw: string): number {
    const m = String(raw).replace(/'/g, '').replace(/\+.*/, '');
    return parseInt(m, 10) || 0;
}

function MomentumArc({ events, homeColor, awayColor, homeAbbr, awayAbbr }: { events: any[]; homeColor: string; awayColor: string; homeAbbr: string; awayAbbr: string }) {
    const w = 520, h = 130, pad = { t: 18, b: 24, l: 0, r: 0 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const pts: { min: number; val: number }[] = [{ min: 0, val: 50 }];
    let momentum = 50;
    for (let m = 5; m <= 90; m += 5) {
        const eventsInRange = events.filter((e: any) => e.min > m - 5 && e.min <= m);
        for (const ev of eventsInRange) {
            if (ev.type === 'goal') momentum += ev.side === 'home' ? 15 : -15;
            if (ev.type === 'red') momentum += ev.side === 'home' ? -10 : 10;
            if (ev.type === 'yellow') momentum += ev.side === 'home' ? -3 : 3;
        }
        momentum = momentum + (50 - momentum) * 0.15;
        momentum = Math.max(10, Math.min(90, momentum));
        pts.push({ min: m, val: momentum });
    }
    const toX = (min: number) => pad.l + (min / 90) * plotW;
    const toY = (val: number) => pad.t + plotH - (val / 100) * plotH;
    const mapped = pts.map((p) => [toX(p.min), toY(p.val)]);
    let d = `M ${mapped[0][0]} ${mapped[0][1]}`;
    for (let i = 1; i < mapped.length; i++) {
        const [x0, y0] = mapped[i - 1];
        const [x1, y1] = mapped[i];
        const cx = (x0 + x1) / 2;
        d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    }
    const areaD = d + ` L ${mapped[mapped.length - 1][0]} ${toY(50)} L ${mapped[0][0]} ${toY(50)} Z`;
    const midY = toY(50);
    return (
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            <defs>
                <linearGradient id="hGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={homeColor} stopOpacity="0.2" /><stop offset="100%" stopColor={homeColor} stopOpacity="0" /></linearGradient>
                <linearGradient id="aGrad" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor={awayColor} stopOpacity="0.15" /><stop offset="100%" stopColor={awayColor} stopOpacity="0" /></linearGradient>
                <clipPath id="clipAbove"><rect x="0" y="0" width={w} height={midY} /></clipPath>
                <clipPath id="clipBelow"><rect x="0" y={midY} width={w} height={h - midY} /></clipPath>
            </defs>
            <line x1={pad.l} y1={midY} x2={w - pad.r} y2={midY} stroke="rgba(15,23,42,0.04)" strokeWidth="1" />
            <path d={areaD} fill="url(#hGrad)" clipPath="url(#clipAbove)" />
            <path d={areaD} fill="url(#aGrad)" clipPath="url(#clipBelow)" />
            <path d={d} fill="none" stroke="rgba(15,23,42,0.25)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1={toX(45)} y1={pad.t - 2} x2={toX(45)} y2={h - pad.b + 2} stroke="rgba(15,23,42,0.06)" strokeWidth="1" strokeDasharray="3 3" />
            <text x={toX(45)} y={h - 6} textAnchor="middle" fill="rgba(15,23,42,0.10)" fontSize="7" fontFamily="'JetBrains Mono', monospace">HT</text>
            {events.filter((ev: any) => ev.type === 'goal' || ev.type === 'red').map((ev: any, i: number) => {
                const x = toX(ev.min);
                const isRed = ev.type === 'red';
                return (<g key={i}><line x1={x} y1={pad.t} x2={x} y2={h - pad.b} stroke={isRed ? 'rgba(239,68,68,0.2)' : ev.side === 'home' ? `${homeColor}33` : `${awayColor}33`} strokeWidth="1" /><circle cx={x} cy={ev.side === 'home' ? pad.t + 3 : h - pad.b - 3} r="3" fill={isRed ? '#ef4444' : ev.side === 'home' ? homeColor : awayColor} stroke="#F8FAFC" strokeWidth="1.5" /><text x={x} y={ev.side === 'home' ? pad.t - 4 : h - pad.b + 12} textAnchor="middle" fill="rgba(15,23,42,0.30)" fontSize="7" fontFamily="'JetBrains Mono', monospace" fontWeight="500">{ev.min}'</text></g>);
            })}
            <text x={pad.l + 4} y={pad.t + 9} fill={homeColor} fontSize="7" fontFamily="'JetBrains Mono', monospace" fontWeight="600" opacity="0.5">{homeAbbr}</text>
            <text x={pad.l + 4} y={h - pad.b - 4} fill={awayColor} fontSize="7" fontFamily="'JetBrains Mono', monospace" fontWeight="600" opacity="0.4">{awayAbbr}</text>
            {[0, 15, 30, 60, 75, 90].map((m) => (<g key={m}><line x1={toX(m)} y1={h - pad.b} x2={toX(m)} y2={h - pad.b + 3} stroke="rgba(255,255,255,0.07)" strokeWidth="1" /><text x={toX(m)} y={h - 6} textAnchor="middle" fill="rgba(15,23,42,0.12)" fontSize="7" fontFamily="'JetBrains Mono', monospace">{m}</text></g>))}
        </svg>
    );
}

function StatRow({ label, home, away, hv, av, idx, homeColor, awayColor }: any) {
    const total = Number(hv) + Number(av) || 1;
    const hp = (Number(hv) / total) * 100;
    const hw = Number(hv) > Number(av), aw = Number(av) > Number(hv);
    const [on, setOn] = useState(false);
    useEffect(() => { const t = setTimeout(() => setOn(true), 150 + idx * 35); return () => clearTimeout(t); }, [idx]);
    return (
        <div className="stat-row">
            <span className="stat-num" data-win={hw ? '1' : '0'} style={{ textAlign: 'right' }}>{home}</span>
            <div className="stat-bar stat-bar--home"><div style={{ width: on ? `${hp}%` : '0%', height: '100%', borderRadius: 2, background: hw ? homeColor : 'rgba(15,23,42,0.12)', transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)' }} /></div>
            <span className="stat-label">{label}</span>
            <div className="stat-bar"><div style={{ width: on ? `${100 - hp}%` : '0%', height: '100%', borderRadius: 2, background: aw ? awayColor : 'rgba(15,23,42,0.12)', transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)' }} /></div>
            <span className="stat-num" data-win={aw ? '1' : '0'} style={{ textAlign: 'left' }}>{away}</span>
        </div>
    );
}

function PlayerRow({ p, color, delay }: { p: any; color: string; delay: number }) {
    return (
        <div className="player-row" style={{ animation: `fadeUp 0.25s ease ${delay}s both` }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color, width: 22, textAlign: 'right', opacity: 0.6, fontWeight: 600 }}>{p.jersey}</span>
            <div style={{ width: 1, height: 14, background: `${color}30` }} />
            <span style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: p.redCards > 0 ? 'rgba(239,68,68,0.7)' : '#0F172A', fontWeight: p.goals > 0 ? 600 : 400, textDecoration: p.redCards > 0 ? 'line-through' : 'none', textDecorationColor: 'rgba(239,68,68,0.3)' }}>{p.name}</span>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'rgba(15,23,42,0.10)', marginLeft: 'auto' }}>{p.position}</span>
            <div style={{ display: 'flex', gap: 3, alignItems: 'center', minWidth: 40, justifyContent: 'flex-end' }}>
                {p.goals > 0 && <span style={{ fontSize: 10 }}>⚽{p.goals > 1 ? `×${p.goals}` : ''}</span>}
                {p.assists > 0 && <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'rgba(15,23,42,0.35)', fontWeight: 600 }}>A{p.assists > 1 ? `×${p.assists}` : ''}</span>}
                {p.yellowCards > 0 && <span style={{ width: 8, height: 10, borderRadius: 1, background: '#eab308', display: 'inline-block' }} />}
                {p.redCards > 0 && <span style={{ width: 8, height: 10, borderRadius: 1, background: '#ef4444', display: 'inline-block' }} />}
            </div>
        </div>
    );
}

function OddsCell({ label, odds, isWin, borderRight }: { label: string; odds: number | null; isWin: boolean; borderRight?: boolean }) {
    return (
        <div style={{ padding: '18px 14px', borderRight: borderRight ? '1px solid rgba(15,23,42,0.03)' : 'none', background: isWin ? 'rgba(34,197,94,0.03)' : 'transparent', textAlign: 'center', position: 'relative' }}>
            {isWin && <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 32, height: 2, borderRadius: 1, background: '#22c55e' }} />}
            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 10, color: 'rgba(15,23,42,0.25)', marginBottom: 8, fontWeight: 500 }}>{label}</div>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 22, fontWeight: 600, color: isWin ? '#22c55e' : odds != null ? '#0F172A' : 'rgba(15,23,42,0.10)', letterSpacing: '-0.02em' }}>{odds != null ? fmtOdds(odds) : '—'}</div>
            {odds != null && <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'rgba(15,23,42,0.15)', marginTop: 5 }}>{(impliedProb(odds) * 100).toFixed(1)}%</div>}
            {isWin && <div style={{ fontFamily: 'var(--f-mono)', fontSize: 7, fontWeight: 700, color: '#22c55e', marginTop: 5, textTransform: 'uppercase', letterSpacing: '0.12em' }}>✓ Result</div>}
        </div>
    );
}

export default function MatchPage() {
    const { slug } = useParams<{ slug: string }>();
    const [match, setMatch] = useState<SoccerPostgame | null>(null);
    const [homeMeta, setHomeMeta] = useState<any>(null);
    const [awayMeta, setAwayMeta] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('overview');
    const [ready, setReady] = useState(false);

    useEffect(() => { const t = setTimeout(() => setReady(true), 60); return () => clearTimeout(t); }, []);

    useEffect(() => {
        let alive = true;
        async function init() {
            if (!slug) return;
            const parsed = parseMatchSlug(slug);
            if (!parsed) { if (alive) setLoading(false); return; }
            const m = await fetchMatchBySlug(parsed.home, parsed.away, parsed.date);
            if (!alive) return;
            setMatch(m);
            if (m) {
                const [hMeta, aMeta] = await Promise.all([fetchTeamMeta(m.home_team), fetchTeamMeta(m.away_team)]);
                if (!alive) return;
                setHomeMeta(hMeta); setAwayMeta(aMeta);
                document.title = `${m.home_team} ${m.home_score}–${m.away_score} ${m.away_team} | ${LEAGUE_SHORT[m.league_id] || m.league_id} | The Drip`;
            }
            if (alive) setLoading(false);
        }
        void init();
        return () => { alive = false; };
    }, [slug]);

    const HC = homeMeta?.color || '#E20520';
    const AC = awayMeta?.color || '#034694';
    const homeAbbr = homeMeta?.abbreviation || match?.home_team?.substring(0, 3).toUpperCase() || 'HOM';
    const awayAbbr = awayMeta?.abbreviation || match?.away_team?.substring(0, 3).toUpperCase() || 'AWY';
    const homeLogo = homeMeta?.logo_url;
    const awayLogo = awayMeta?.logo_url;

    const matchEvents = useMemo(() => {
        if (!match) return [];
        const evts: any[] = [];
        if (Array.isArray(match.goals)) { match.goals.forEach((g: any) => evts.push({ min: parseMinute(g.minute), type: 'goal', side: g.side, player: g.scorer, detail: g.assister ? `Assist: ${g.assister}` : '', desc: g.description, raw: g.minute })); }
        if (Array.isArray(match.cards)) { match.cards.forEach((c: any) => evts.push({ min: parseMinute(c.minute), type: c.card_type === 'red' ? 'red' : 'yellow', side: c.side, player: c.player, detail: c.card_type === 'red' ? 'Red card' : 'Yellow card', raw: c.minute })); }
        return evts.sort((a, b) => a.min - b.min);
    }, [match]);

    const hasOdds = match?.dk_home_ml != null;
    const spreadRes = match ? getSpreadResult(match) : null;
    const totalRes = match ? getTotalResult(match) : null;
    const mlRes = match ? getMLResult(match) : null;

    const statsData = useMemo(() => {
        if (!match) return [];
        return [
            { label: 'Possession', home: `${match.home_possession ?? '-'}%`, away: `${match.away_possession ?? '-'}%`, hv: match.home_possession ?? 50, av: match.away_possession ?? 50 },
            { label: 'Shots', home: match.home_shots, away: match.away_shots, hv: match.home_shots, av: match.away_shots },
            { label: 'On Target', home: match.home_shots_on_target, away: match.away_shots_on_target, hv: match.home_shots_on_target, av: match.away_shots_on_target },
            { label: 'Passes', home: match.home_passes, away: match.away_passes, hv: match.home_passes, av: match.away_passes },
            { label: 'Pass %', home: match.home_pass_pct != null ? `${Math.round(match.home_pass_pct * 100)}%` : '-', away: match.away_pass_pct != null ? `${Math.round(match.away_pass_pct * 100)}%` : '-', hv: match.home_pass_pct ?? 0.5, av: match.away_pass_pct ?? 0.5 },
            { label: 'Corners', home: match.home_corners, away: match.away_corners, hv: match.home_corners, av: match.away_corners },
            { label: 'Fouls', home: match.home_fouls, away: match.away_fouls, hv: match.home_fouls, av: match.away_fouls },
            { label: 'Tackles', home: match.home_tackles, away: match.away_tackles, hv: match.home_tackles, av: match.away_tackles },
            { label: 'Clearances', home: match.home_clearances, away: match.away_clearances, hv: match.home_clearances, av: match.away_clearances },
            { label: 'Saves', home: match.home_saves, away: match.away_saves, hv: match.home_saves, av: match.away_saves },
            { label: 'Interceptions', home: match.home_interceptions, away: match.away_interceptions, hv: match.home_interceptions, av: match.away_interceptions },
            { label: 'Offsides', home: match.home_offsides, away: match.away_offsides, hv: match.home_offsides, av: match.away_offsides },
        ].filter((s) => s.hv != null && s.av != null);
    }, [match]);

    const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'stats', label: 'Stats' }, ...(hasOdds ? [{ id: 'odds', label: 'Odds' }] : []), { id: 'lineups', label: 'Lineups' }];

    if (loading) return (<div className="mp-loading"><style>{`:root { --f-serif: 'Newsreader', Georgia, serif; --f-mono: 'JetBrains Mono', monospace; --f-sans: 'DM Sans', system-ui, sans-serif; } @keyframes spin { to { transform: rotate(360deg); } } .mp-loading { min-height: 100vh; background: #080808; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }`}</style><div style={{ width: 20, height: 20, border: '2px solid rgba(15,23,42,0.08)', borderTop: '2px solid rgba(15,23,42,0.35)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /><div style={{ color: 'rgba(15,23,42,0.22)', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Loading</div></div>);

    if (!match) return (<div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: C.text }}><div style={{ fontFamily: 'var(--f-serif)', fontSize: 24, fontWeight: 500 }}>Match not found</div><Link to="/reports" style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'rgba(15,23,42,0.25)', textDecoration: 'none', padding: '8px 16px', border: '1px solid rgba(15,23,42,0.06)', borderRadius: 8 }}>← Back to Reports</Link></div>);

    const formattedDate = new Date(match.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const totalGoals = match.home_score + match.away_score;
    const homeSpreadStr = match.dk_spread != null ? (match.dk_spread > 0 ? `+${match.dk_spread}` : String(match.dk_spread)) : '—';
    const awaySpreadStr = match.dk_spread != null ? (match.dk_spread > 0 ? `-${match.dk_spread}` : `+${Math.abs(match.dk_spread)}`) : '—';

    return (
        <div className="mp-page">
            <style>{`
        :root { --f-serif: 'Newsreader', Georgia, serif; --f-mono: 'JetBrains Mono', monospace; --f-sans: 'DM Sans', system-ui, sans-serif; }
        * { box-sizing: border-box; } ::selection { background: rgba(59,130,246,0.20); }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes revealScore { 0% { opacity: 0; transform: scale(0.85) translateY(4px); } 50% { transform: scale(1.02) translateY(-1px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes expandLine { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .mp-page { min-height: 100vh; background: #080808; display: flex; align-items: flex-start; justify-content: center; padding: clamp(18px, 3.5vw, 32px) 16px 88px; --cardW: 640px; --cardPad: clamp(16px, 3.2vw, 22px); --section: clamp(16px, 3.2vw, 22px); --border: rgba(15,23,42,0.06); }
        .intel-card { width: 100%; max-width: var(--cardW); background: rgba(255,255,255,0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-radius: 20px; overflow: hidden; border: 1px solid rgba(15,23,42,0.06); box-shadow: inset 0 1px 0 rgba(15,23,42,0.04), 0 8px 32px rgba(0,0,0,0.06), 0 24px 64px rgba(0,0,0,0.08); }
        .topbar { padding: 12px var(--cardPad); display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(15,23,42,0.03); background: rgba(15,23,42,0.008); }
        .tabRail { display: flex; gap: 6px; padding: 8px var(--cardPad); border-top: 1px solid rgba(15,23,42,0.03); border-bottom: 1px solid rgba(15,23,42,0.03); background: rgba(15,23,42,0.005); overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .tabRail::-webkit-scrollbar { height: 0; }
        .tab-btn { all: unset; cursor: pointer; font-family: var(--f-mono); font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; padding: 10px 14px; border-radius: 10px; color: rgba(15,23,42,0.20); transition: background 0.2s ease, color 0.2s ease; position: relative; white-space: nowrap; flex: 0 0 auto; }
        .tab-btn:hover { color: rgba(15,23,42,0.40); background: rgba(15,23,42,0.02); }
        .tab-btn[data-active="true"] { color: rgba(15,23,42,0.85); background: rgba(15,23,42,0.06); }
        .tab-btn[data-active="true"]::after { content: ''; position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%); width: 16px; height: 2px; border-radius: 1px; background: rgba(15,23,42,0.25); }
        .contentPad { padding: var(--section) var(--cardPad) calc(var(--section) + 10px); min-height: 320px; }
        .hero { padding: clamp(26px, 5.2vw, 44px) var(--cardPad) clamp(18px, 4vw, 32px); position: relative; overflow: hidden; }
        .heroGrid { position: relative; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; }
        @media (max-width: 560px) { .heroGrid { grid-template-columns: 1fr; gap: 16px; } }
        .team-link { text-decoration: none; color: inherit; transition: opacity 0.15s, transform 0.25s cubic-bezier(0.4,0,0.2,1); }
        .team-link:hover { opacity: 0.9; transform: translateY(-2px); }
        .kpiGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
        @media (max-width: 720px) { .kpiGrid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
        @media (max-width: 520px) { .kpiGrid { grid-template-columns: 1fr; } }
        .kpi-card { transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), background 0.2s ease, box-shadow 0.2s ease; cursor: default; }
        .kpi-card:hover { transform: translateY(-3px); background: rgba(15,23,42,0.025) !important; box-shadow: 0 8px 24px rgba(0,0,0,0.04); border-color: rgba(15,23,42,0.09) !important; }
        .insight-box { padding: 18px 20px; background: rgba(15,23,42,0.015); border: 1px solid rgba(15,23,42,0.04); border-radius: 12px; transition: background 0.2s ease, border-color 0.2s ease; }
        .insight-box:hover { background: rgba(15,23,42,0.03); border-color: rgba(15,23,42,0.09); }
        .odds-panel { border: 1px solid rgba(15,23,42,0.04); border-radius: 12px; overflow: hidden; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
        .odds-panel:hover { border-color: rgba(15,23,42,0.08); box-shadow: 0 4px 24px rgba(0,0,0,0.04); }
        .tableScroll { overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
        .tableInner { min-width: 560px; }
        .stat-head { display: grid; grid-template-columns: 52px 1fr 84px 1fr 52px; align-items: center; margin-bottom: 6px; padding-bottom: 10px; border-bottom: 1px solid rgba(15,23,42,0.03); }
        .stat-row { display: grid; grid-template-columns: 52px 1fr 84px 1fr 52px; align-items: center; border-bottom: 1px solid rgba(15,23,42,0.02); padding: 10px 0; border-radius: 10px; transition: background 0.2s ease; }
        .stat-row:hover { background: rgba(15,23,42,0.02); }
        .stat-num { font-family: var(--f-mono); font-size: 12px; font-weight: 400; color: rgba(15,23,42,0.30); transition: color 0.35s ease; }
        .stat-num[data-win="1"] { color: #fff; font-weight: 650; }
        .stat-label { font-family: var(--f-serif); font-size: 10px; font-weight: 400; color: rgba(15,23,42,0.22); text-align: center; text-transform: uppercase; letter-spacing: 0.06em; font-style: italic; padding: 0 8px; }
        .stat-bar { height: 3px; border-radius: 2px; overflow: hidden; background: rgba(15,23,42,0.03); margin: 0 14px; }
        .stat-bar--home { direction: rtl; }
        .player-row { transition: background 0.2s ease, transform 0.2s ease; padding: 7px 10px; margin: 0 -10px; border-radius: 6px; display: flex; align-items: center; gap: 10px; }
        .player-row:hover { background: rgba(15,23,42,0.035); transform: translateX(2px); }
        .timeline-event { transition: background 0.2s ease; padding: 10px; margin: 0 -10px; border-radius: 8px; }
        .timeline-event:hover { background: rgba(15,23,42,0.025); }
      `}</style>

            <div className="intel-card" style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.5s ease' }}>
                <div className="topbar">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Link to="/reports" style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'rgba(15,23,42,0.18)', textDecoration: 'none', letterSpacing: '0.06em', padding: '4px 10px', border: '1px solid rgba(15,23,42,0.06)', borderRadius: 8, transition: 'all 0.15s', lineHeight: 1 }}>←</Link>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="2.5" fill={HC} opacity="0.6" /></svg>
                            <span style={{ fontFamily: 'var(--f-sans)', fontSize: 10, fontWeight: 700, color: 'rgba(15,23,42,0.25)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>{LEAGUE_LABELS[match.league_id] || LEAGUE_SHORT[match.league_id] || match.league_id}</span>
                        </div>
                    </div>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'rgba(15,23,42,0.10)', letterSpacing: '0.04em' }}>{formattedDate}</span>
                </div>

                <div className="hero">
                    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                        <div style={{ position: 'absolute', left: '15%', top: '30%', width: 220, height: 220, borderRadius: '50%', background: HC, opacity: 0.03, filter: 'blur(80px)' }} />
                        <div style={{ position: 'absolute', right: '15%', bottom: '20%', width: 220, height: 220, borderRadius: '50%', background: AC, opacity: 0.03, filter: 'blur(80px)' }} />
                    </div>
                    <div className="heroGrid">
                        <Link to={teamUrl(match.home_team)} className="team-link" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, animation: 'fadeUp 0.5s ease 0.1s both' }}>
                            {homeLogo ? <img src={homeLogo} alt={match.home_team} style={{ width: 64, height: 64, objectFit: 'contain', filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.08))' }} /> : <div style={{ width: 64, height: 64, borderRadius: '50%', background: `linear-gradient(135deg, ${HC}, ${HC}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 'bold', color: C.text }}>{match.home_team[0]}</div>}
                            <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>{match.home_team}</div></div>
                        </Link>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '0 10px', animation: 'revealScore 0.7s ease 0.2s both' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                                <span style={{ fontFamily: 'var(--f-serif)', fontSize: 60, fontWeight: 500, color: C.text, lineHeight: 1, letterSpacing: '-0.04em' }}>{match.home_score}</span>
                                <span style={{ fontFamily: 'var(--f-serif)', fontSize: 20, color: 'rgba(15,23,42,0.08)', fontWeight: 300, lineHeight: 1, marginBottom: 4 }}>–</span>
                                <span style={{ fontFamily: 'var(--f-serif)', fontSize: 60, fontWeight: 500, color: match.away_score > match.home_score ? '#0F172A' : 'rgba(15,23,42,0.30)', lineHeight: 1, letterSpacing: '-0.04em' }}>{match.away_score}</span>
                            </div>
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.18em', background: 'rgba(34,197,94,0.06)', padding: '3px 12px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.08)' }}>Full Time</span>
                        </div>
                        <Link to={teamUrl(match.away_team)} className="team-link" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, animation: 'fadeUp 0.5s ease 0.15s both' }}>
                            {awayLogo ? <img src={awayLogo} alt={match.away_team} style={{ width: 64, height: 64, objectFit: 'contain', filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.08))' }} /> : <div style={{ width: 64, height: 64, borderRadius: '50%', background: `linear-gradient(135deg, ${AC}, ${AC}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 'bold', color: C.text }}>{match.away_team[0]}</div>}
                            <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 800, color: 'rgba(15,23,42,0.55)', letterSpacing: '-0.02em' }}>{match.away_team}</div></div>
                        </Link>
                    </div>
                    {match.venue && <div style={{ position: 'relative', textAlign: 'center', marginTop: 18, animation: 'fadeIn 0.5s ease 0.45s both' }}><span style={{ fontFamily: 'var(--f-serif)', fontSize: 11, fontStyle: 'italic', color: 'rgba(15,23,42,0.12)' }}>{match.venue}{match.attendance ? ` · ${match.attendance.toLocaleString()}` : ''}{match.referee ? ` · ${match.referee}` : ''}</span></div>}
                </div>

                {matchEvents.length > 0 && <div style={{ padding: `0 var(--cardPad) 14px`, animation: 'fadeIn 0.5s ease 0.5s both' }}><div style={{ fontFamily: 'var(--f-mono)', fontSize: 8, fontWeight: 700, color: 'rgba(15,23,42,0.12)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 6 }}>Match Momentum</div><MomentumArc events={matchEvents} homeColor={HC} awayColor={AC} homeAbbr={homeAbbr} awayAbbr={awayAbbr} /></div>}

                <div className="tabRail">{tabs.map((t) => <button key={t.id} className="tab-btn" data-active={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>

                <div className="contentPad" key={tab}>
                    {tab === 'overview' && <div style={{ animation: 'fadeIn 0.25s ease' }}>
                        {matchEvents.length > 0 && <div style={{ marginBottom: 18 }}>{matchEvents.map((ev: any, i: number) => <div key={i} className="timeline-event" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid rgba(15,23,42,0.015)', animation: `fadeUp 0.3s ease ${i * 0.04}s both` }}><span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 600, color: 'rgba(15,23,42,0.18)', width: 38, textAlign: 'right', flexShrink: 0, paddingTop: 1 }}>{ev.raw}</span><div style={{ width: 3, minHeight: 30, borderRadius: 2, flexShrink: 0, marginTop: 1, background: ev.type === 'red' ? '#dc2626' : ev.type === 'yellow' ? '#eab308' : ev.side === 'home' ? HC : AC, opacity: ev.type === 'goal' ? 0.8 : 0.5 }} /><div style={{ flex: 1 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 12 }}>{ev.type === 'red' ? '🟥' : ev.type === 'yellow' ? '🟨' : '⚽'}</span><span style={{ fontFamily: 'var(--f-sans)', fontSize: 13, fontWeight: 700, color: ev.type === 'red' ? 'rgba(239,68,68,0.8)' : '#0F172A' }}>{ev.player}</span><span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, fontWeight: 700, color: ev.side === 'home' ? HC : AC, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{ev.side === 'home' ? homeAbbr : awayAbbr}</span></div>{ev.detail && <div style={{ fontFamily: 'var(--f-serif)', fontSize: 11, fontStyle: 'italic', color: 'rgba(15,23,42,0.22)', marginTop: 3 }}>{ev.detail}</div>}</div></div>)}</div>}
                        <div style={{ height: 1, background: 'rgba(15,23,42,0.03)', margin: '6px 0 18px', transformOrigin: 'left', animation: 'expandLine 0.6s ease 0.3s both' }} />
                        <div className="insight-box" style={{ animation: 'fadeUp 0.35s ease 0.35s both' }}><div style={{ fontFamily: 'var(--f-mono)', fontSize: 8, fontWeight: 700, color: HC, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10, opacity: 0.6 }}>Match Summary</div><p style={{ fontFamily: 'var(--f-serif)', fontSize: 14, color: 'rgba(15,23,42,0.45)', lineHeight: 1.75, margin: 0 }}>{match.home_team} {match.home_score > match.away_score ? 'defeated' : match.home_score < match.away_score ? 'lost to' : 'drew with'} {match.away_team} {match.home_score}–{match.away_score}.{match.home_possession != null && ` ${(match.home_possession > 50 ? match.home_team : match.away_team)} controlled possession at ${Math.max(match.home_possession, match.away_possession || 0).toFixed(1)}%.`}{match.home_shots != null && ` The match produced ${(match.home_shots || 0) + (match.away_shots || 0)} shots with ${(match.home_shots_on_target || 0) + (match.away_shots_on_target || 0)} on target.`}{hasOdds && ` ${match.home_team} closed at ${fmtOdds(match.dk_home_ml)} on DraftKings.`}{spreadRes && ` ATS: ${spreadRes.result === 'covered' ? 'Covered' : spreadRes.result === 'failed' ? 'Failed to cover' : 'Push'} the ${match.dk_spread! > 0 ? '+' : ''}${match.dk_spread} spread.`}</p></div>
                        <div className="kpiGrid" style={{ animation: 'fadeUp 0.35s ease 0.45s both' }}>{[{ val: `${match.home_shots || 0}–${match.away_shots || 0}`, label: 'Total Shots', sub: `${match.home_shots_on_target || 0}–${match.away_shots_on_target || 0} on target` }, { val: `${match.home_possession ?? '-'}%`, label: `${match.home_team.split(' ').pop()} Poss.`, sub: `${match.away_possession ?? '-'}% opp.` }, { val: String(totalGoals), label: 'Total Goals', sub: `${(match.home_corners || 0) + (match.away_corners || 0)} corners` }].map((kpi, i) => <div key={i} className="kpi-card" style={{ padding: '16px 14px', background: 'rgba(15,23,42,0.012)', borderRadius: 12, border: '1px solid rgba(15,23,42,0.03)' }}><div style={{ fontFamily: 'var(--f-serif)', fontSize: 26, fontWeight: 500, color: C.text, letterSpacing: '-0.03em', lineHeight: 1 }}>{kpi.val}</div><div style={{ fontFamily: 'var(--f-sans)', fontSize: 10, color: 'rgba(15,23,42,0.30)', marginTop: 6, lineHeight: 1.3, fontWeight: 600 }}>{kpi.label}</div><div style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'rgba(15,23,42,0.15)', marginTop: 3 }}>{kpi.sub}</div></div>)}</div>
                    </div>}

                    {tab === 'stats' && <div style={{ animation: 'fadeIn 0.25s ease' }}><div className="tableScroll"><div className="tableInner"><div className="stat-head"><span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 800, color: HC, textAlign: 'right', opacity: 0.6 }}>{homeAbbr}</span><span /><span /><span /><span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 800, color: AC, textAlign: 'left', opacity: 0.6 }}>{awayAbbr}</span></div>{statsData.map((s, i) => <StatRow key={s.label} {...s} idx={i} homeColor={HC} awayColor={AC} />)}</div></div></div>}

                    {tab === 'odds' && hasOdds && <div style={{ animation: 'fadeIn 0.25s ease', display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div className="odds-panel"><div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(15,23,42,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, fontWeight: 700, color: 'rgba(15,23,42,0.18)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Closing Moneyline</span><span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'rgba(15,23,42,0.12)' }}>DraftKings</span></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}><OddsCell label={match.home_team} odds={match.dk_home_ml} isWin={mlRes === 'home'} borderRight /><OddsCell label="Draw" odds={match.dk_draw_ml} isWin={mlRes === 'draw'} borderRight /><OddsCell label={match.away_team} odds={match.dk_away_ml} isWin={mlRes === 'away'} /></div></div>
                        <div className="odds-panel"><div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(15,23,42,0.03)' }}><span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, fontWeight: 700, color: 'rgba(15,23,42,0.18)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Against the Spread</span></div><div style={{ padding: '16px 18px' }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'baseline' }}><span style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: C.text, fontWeight: 600 }}>{match.home_team}</span><span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'rgba(15,23,42,0.45)' }}>{homeSpreadStr} <span style={{ color: 'rgba(15,23,42,0.22)' }}>({fmtOdds(match.dk_home_spread_price)})</span></span></div><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'baseline' }}><span style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: 'rgba(15,23,42,0.55)', fontWeight: 600 }}>{match.away_team}</span><span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'rgba(15,23,42,0.45)' }}>{awaySpreadStr} <span style={{ color: 'rgba(15,23,42,0.22)' }}>({fmtOdds(match.dk_away_spread_price)})</span></span></div><div style={{ borderTop: '1px solid rgba(15,23,42,0.03)', paddingTop: 14 }}><div style={{ fontFamily: 'var(--f-mono)', fontSize: 13, fontWeight: 700, color: spreadRes?.result === 'covered' ? '#22c55e' : spreadRes?.result === 'failed' ? '#ef4444' : 'rgba(15,23,42,0.25)' }}>{spreadRes?.result === 'covered' ? `✓ ${match.home_team} Covered` : spreadRes?.result === 'failed' ? '✗ Failed to Cover' : 'Push'}{spreadRes?.margin != null && <span style={{ fontWeight: 500, color: 'rgba(15,23,42,0.18)', marginLeft: 8 }}>by {spreadRes.margin}</span>}</div></div></div></div>
                        <div className="odds-panel"><div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(15,23,42,0.03)' }}><span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, fontWeight: 700, color: 'rgba(15,23,42,0.18)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Over / Under</span></div><div style={{ padding: '16px 18px' }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><span style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: C.text, fontWeight: 600 }}>Over {match.dk_total}</span><span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'rgba(15,23,42,0.45)' }}>{fmtOdds(match.dk_over_price)}</span></div><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}><span style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: 'rgba(15,23,42,0.55)', fontWeight: 600 }}>Under {match.dk_total}</span><span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'rgba(15,23,42,0.45)' }}>{fmtOdds(match.dk_under_price)}</span></div><div style={{ borderTop: '1px solid rgba(15,23,42,0.03)', paddingTop: 14 }}><div style={{ fontFamily: 'var(--f-mono)', fontSize: 13, fontWeight: 700, color: totalRes?.result === 'over' ? '#22c55e' : totalRes?.result === 'under' ? '#22c55e' : 'rgba(15,23,42,0.25)' }}>{totalRes?.result === 'over' ? '✓ Over Hit' : totalRes?.result === 'under' ? '✓ Under Hit' : 'Push'}<span style={{ fontWeight: 500, color: 'rgba(15,23,42,0.18)', marginLeft: 8 }}>({totalGoals} total goals)</span></div></div></div></div>
                        <div className="insight-box" style={{ animation: 'fadeUp 0.35s ease 0.25s both' }}><div style={{ fontFamily: 'var(--f-mono)', fontSize: 8, fontWeight: 700, color: 'rgba(15,23,42,0.15)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>Closing Market Summary</div><p style={{ fontFamily: 'var(--f-serif)', fontSize: 13, fontStyle: 'italic', color: 'rgba(15,23,42,0.35)', lineHeight: 1.7, margin: 0 }}>{match.home_team} closed at {fmtOdds(match.dk_home_ml)} ({(impliedProb(match.dk_home_ml!) * 100).toFixed(0)}% implied). The spread was set at {homeSpreadStr} with the total at {match.dk_total} goals. The actual total of {totalGoals} goals {totalRes?.result === 'over' ? 'cleared' : totalRes?.result === 'under' ? 'stayed under' : 'landed exactly on'} the line.</p></div>
                    </div>}

                    {tab === 'lineups' && <div style={{ animation: 'fadeIn 0.25s ease' }}>{[{ label: match.home_team, lineup: match.home_lineup, color: HC, logo: homeLogo }, { label: match.away_team, lineup: match.away_lineup, color: AC, logo: awayLogo }].map((team, ti) => { const players = Array.isArray(team.lineup) ? team.lineup : []; const starters = players.filter((p: any) => p.starter); const subs = players.filter((p: any) => !p.starter && p.subbedIn); return (<div key={ti} style={{ marginBottom: ti === 0 ? 28 : 0 }}><div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>{team.logo && <img src={team.logo} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />}<span style={{ fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 800, color: ti === 0 ? '#0F172A' : 'rgba(15,23,42,0.55)' }}>{team.label}</span><span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'rgba(15,23,42,0.10)', marginLeft: 'auto' }}>{starters.length} starters</span></div>{starters.map((p: any, pi: number) => <PlayerRow key={pi} p={p} color={team.color} delay={pi * 0.025} />)}{subs.length > 0 && <><div style={{ height: 1, background: 'rgba(15,23,42,0.03)', margin: '12px 0 8px' }} /><div style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'rgba(15,23,42,0.12)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Used Substitutes</div>{subs.map((p: any, pi: number) => <PlayerRow key={pi} p={p} color={team.color} delay={0} />)}</>}</div>); })}</div>}
                </div>

                <div style={{ padding: `10px var(--cardPad)`, borderTop: '1px solid rgba(15,23,42,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 7, color: 'rgba(15,23,42,0.08)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Sources: Public APIs · DraftKings</span>
                    <span style={{ fontFamily: 'var(--f-sans)', fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.1)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>thedrip.to</span>
                </div>
            </div>
        </div>
    );
}

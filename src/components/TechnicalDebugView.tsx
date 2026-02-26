
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Match } from '@/types';
import { Activity, Database, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/essence';
import { getCanonicalMatchId } from '../utils/matchRegistry';


type DebugValue = string | number | boolean | null | DebugValue[] | { [key: string]: DebugValue };

interface DebugState {
    matchInDb: DebugValue;
    canonicalGame: DebugValue;
    marketFeed: DebugValue;
    liveGameState: DebugValue;
    lastIngestStatus: 'idle' | 'loading' | 'success' | 'error';
    lastIngestError?: string;
    lastIngestDebug?: DebugValue;
    pregameIntel?: DebugValue;
    activeConversation?: DebugValue;
}

export const TechnicalDebugView = ({ match }: { match: Match }) => {
    const [debugData, setDebugData] = useState<DebugState>({
        matchInDb: null,
        canonicalGame: null,
        marketFeed: null,
        liveGameState: null,
        lastIngestStatus: 'idle'
    });
    const [isOpen, setIsOpen] = useState(false);

    const refreshDebugData = async () => {
        try {
            const dbId = getCanonicalMatchId(match.id, match.leagueId);
            const canonicalId = match.canonical_id;

            const [dbRes, kgRes, mktRes, liveRes, intelRes, convRes] = await Promise.all([
                supabase.from('matches').select('*').eq('id', dbId).maybeSingle(),
                canonicalId ? supabase.from('canonical_games').select('*').eq('id', canonicalId).maybeSingle() : Promise.resolve({ data: null }),
                canonicalId ? supabase.from('market_feeds').select('*').eq('canonical_id', canonicalId).maybeSingle() : Promise.resolve({ data: null }),
                supabase.from('live_game_state').select('*').eq('id', dbId).maybeSingle(),
                supabase.from('pregame_intel').select('*').eq('match_id', canonicalId || dbId).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
                supabase.from('conversations').select('*').eq('current_match_id', dbId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
            ]);


            setDebugData(prev => ({
                ...prev,
                matchInDb: dbRes.data,
                canonicalGame: kgRes.data,
                marketFeed: mktRes.data,
                liveGameState: liveRes.data,
                pregameIntel: intelRes.data,
                activeConversation: convRes.data
            }));
        } catch (e) {
            console.error("Debug fetch failed", e);
        }
    };

    const manualIngest = async () => {
        setDebugData(prev => ({ ...prev, lastIngestStatus: 'loading', lastIngestError: undefined, lastIngestDebug: undefined }));
        try {
            // Map leagueId to OddsAPI sport_key
            const sportKeyMap: Record<string, string> = {
                'mens-college-basketball': 'basketball_ncaab',
                'college-football': 'americanfootball_ncaaf',
                'nba': 'basketball_nba',
                'nfl': 'americanfootball_nfl',
                'mlb': 'baseball_mlb',
                'nhl': 'icehockey_nhl',
                'eng.1': 'soccer_epl',
                'esp.1': 'soccer_spain_la_liga',
                'ita.1': 'soccer_italy_serie_a',
                'ger.1': 'soccer_germany_bundesliga',
                'fra.1': 'soccer_france_ligue_one',
                'usa.1': 'soccer_usa_mls',
                'uefa.champions': 'soccer_uefa_champs_league',
                'uefa.europa': 'soccer_uefa_europa_league'
            };

            const sportKey = sportKeyMap[match.leagueId] || match.leagueId;

            const { data, error } = await supabase.functions.invoke('ingest-odds', {
                body: { sport_key: sportKey },
                headers: {
                    'x-cron-secret': "XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ"
                }
            });

            if (error) throw error;

            if (data?.error) {
                setDebugData(prev => ({
                    ...prev,
                    lastIngestStatus: 'error',
                    lastIngestError: data.error,
                    lastIngestDebug: data.debug
                }));
            } else {
                setDebugData(prev => ({
                    ...prev,
                    lastIngestStatus: 'success',
                    lastIngestDebug: data.debug
                }));
                refreshDebugData();
            }
        } catch (e: Error | { message?: string } | string) {
            const msg = typeof e === 'string' ? e : e?.message;
            setDebugData(prev => ({ ...prev, lastIngestStatus: 'error', lastIngestError: msg }));
        }
    };

    useEffect(() => {
        if (isOpen) {
            refreshDebugData();
            const interval = setInterval(refreshDebugData, 5000);
            return () => clearInterval(interval);
        }
    }, [isOpen, match.id]);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 right-4 z-[9999] p-3 bg-zinc-900/90 border border-white/10 rounded-full shadow-2xl backdrop-blur-md hover:bg-zinc-800 transition-all group"
            >
                <Activity size={18} className="text-zinc-500 group-hover:text-cyan-400" />
            </button>
        );
    }

    const getTimeDelta = (dateStr?: string) => {
        if (!dateStr) return 'N/A';
        const delta = (Date.now() - new Date(dateStr).getTime()) / 1000;
        if (delta < 60) return `${Math.floor(delta)}s ago`;
        return `${Math.floor(delta / 60)}m ago`;
    };

    return (
        <div className="fixed inset-y-0 right-0 w-96 z-[9999] bg-zinc-950 border-l border-white/10 shadow-2xl flex flex-col font-mono text-caption animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-900/50">
                <div className="flex items-center gap-2">
                    <Database size={14} className="text-cyan-400" />
                    <span className="font-bold text-zinc-200 uppercase tracking-widest">SRE Debug Monitor</span>
                </div>
                <button onClick={() => setIsOpen(false)} className="text-zinc-500 hover:text-white">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                {/* Identity Layer */}
                <section className="space-y-2">
                    <h4 className="text-zinc-500 uppercase tracking-tighter flex items-center gap-1">
                        <span className="w-1 h-1 bg-cyan-500 rounded-full" /> Identity Center
                    </h4>
                    <div className="space-y-1 bg-white/5 p-2 rounded">
                        <div className="flex justify-between"><span className="text-zinc-500">Match ID:</span> <span className="text-zinc-300">{match.id}</span></div>
                        <div className="flex justify-between"><span className="text-zinc-500">Canonical:</span> <span className={cn(match.canonical_id ? "text-cyan-400" : "text-red-400")}>{match.canonical_id || 'MISSING'}</span></div>
                        <div className="flex justify-between"><span className="text-zinc-500">League:</span> <span className="text-zinc-300">{match.leagueId}</span></div>
                        <div className="flex justify-between"><span className="text-zinc-500">Provider:</span> <span className="text-cyan-400">{debugData.matchInDb?.current_odds?.provider || 'Unknown'}</span></div>
                    </div>
                </section>

                {/* Sync Status */}
                <section className="space-y-2">
                    <h4 className="text-zinc-500 uppercase tracking-tighter flex items-center gap-1">
                        <span className="w-1 h-1 bg-green-500 rounded-full" /> Sync Freshness
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-white/5 p-2 rounded">
                            <div className="text-nano text-zinc-500 uppercase">Match Last Updated</div>
                            <div className="text-sm font-bold text-green-400">{getTimeDelta(debugData.matchInDb?.last_updated)}</div>
                        </div>
                        <div className="bg-white/5 p-2 rounded">
                            <div className="text-nano text-zinc-500 uppercase">Feed Last Updated</div>
                            <div className="text-sm font-bold text-cyan-400">{getTimeDelta(debugData.marketFeed?.last_updated)}</div>
                        </div>
                    </div>
                </section>

                {/* Ingest Control */}
                <section className="space-y-2">
                    <h4 className="text-zinc-500 uppercase tracking-tighter">Manual Ingest Override</h4>
                    <button
                        onClick={manualIngest}
                        disabled={debugData.lastIngestStatus === 'loading'}
                        className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-800 text-white rounded font-bold flex items-center justify-center gap-2 transition-colors uppercase tracking-widest"
                    >
                        {debugData.lastIngestStatus === 'loading' ? <RefreshCw className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                        Trigger Ingest
                    </button>

                    {debugData.lastIngestStatus === 'error' && (
                        <div className="p-2 bg-red-900/20 border border-red-500/20 rounded flex items-start gap-2 text-red-400">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            <span>{debugData.lastIngestError}</span>
                        </div>
                    )}
                </section>

                {/* Provider Raw Data */}
                <section className="space-y-2">
                    <h4 className="text-zinc-500 uppercase tracking-tighter flex items-center gap-1">
                        <span className="w-1 h-1 bg-purple-500 rounded-full" /> Provider Payload Analysis
                    </h4>
                    <div className="bg-purple-900/10 border border-purple-500/20 p-2 rounded space-y-1">
                        {debugData.matchInDb?.current_odds?._debug_raw ? (
                            <>
                                <div className="flex justify-between items-center pb-1 border-b border-purple-500/10 mb-1">
                                    <span className="text-zinc-500">PROVIDER_RAW</span>
                                    <span className="text-nano text-purple-400 font-bold tracking-widest">{debugData.matchInDb.current_odds.provider}</span>
                                </div>
                                <div className="flex justify-between"><span className="text-zinc-500">Raw Spread:</span> <span className="text-zinc-200 font-bold">{debugData.matchInDb.current_odds._debug_raw.spread_point ?? 'N/A'} <span className="text-zinc-500 text-nano">({debugData.matchInDb.current_odds._debug_raw.spread_price ?? '-'})</span></span></div>
                                <div className="flex justify-between"><span className="text-zinc-500">Raw Total:</span> <span className="text-zinc-200 font-bold">{debugData.matchInDb.current_odds._debug_raw.total_point ?? 'N/A'} <span className="text-zinc-500 text-nano">({debugData.matchInDb.current_odds._debug_raw.total_price ?? '-'})</span></span></div>
                                <div className="text-[7px] text-zinc-600 mt-1 italic">Normalized in-app for Rest of Game offsets</div>
                            </>
                        ) : (
                            <div className="text-zinc-600 italic py-2 text-center underline decoration-dotted">Awaiting provider telemetry. Run a query to populate instrumentation.</div>
                        )}
                    </div>
                </section>

                {/* Traces */}
                <section className="space-y-4">
                    <details className="group" open>
                        <summary className="cursor-pointer text-cyan-500 hover:text-cyan-300 transition-colors uppercase py-1 border-b border-cyan-500/20 flex justify-between items-center">
                            <span className="flex items-center gap-2">
                                <Activity size={12} />
                                Logic Trace (The Brain)
                            </span>
                            <span className="group-open:rotate-180 transition-transform text-nano">▼</span>
                        </summary>
                        <div className="mt-2 space-y-1 bg-black/40 p-2 rounded border border-white/5 max-h-48 overflow-y-auto custom-scrollbar">
                            {debugData.liveGameState?.logic_trace ? (
                                debugData.liveGameState.logic_trace.map((lineStr: string, i: number) => (
                                    <div key={i} className="flex gap-2 text-nano">
                                        <span className="text-zinc-600 shrink-0 w-3">{i + 1}</span>
                                        <span className="text-zinc-300">{lineStr}</span>
                                    </div>
                                ))
                            ) : (
                                <span className="text-zinc-500 italic">No logic trace available</span>
                            )}
                        </div>
                    </details>

                    <details className="group" open>
                        <summary className="cursor-pointer text-orange-500 hover:text-orange-300 transition-colors uppercase py-1 border-b border-orange-500/20 flex justify-between items-center">
                            <span className="flex items-center gap-2">
                                <Activity size={12} />
                                Discovery Trace (Capture)
                            </span>
                            <span className="group-open:rotate-180 transition-transform text-nano">▼</span>
                        </summary>
                        <div className="mt-2 space-y-1 bg-black/40 p-2 rounded border border-white/5 max-h-48 overflow-y-auto custom-scrollbar">
                            {debugData.matchInDb?.ingest_trace ? (
                                debugData.matchInDb.ingest_trace.map((lineStr: string, i: number) => (
                                    <div key={i} className="flex gap-2 text-nano">
                                        <span className="text-zinc-600 shrink-0 w-3">{i + 1}</span>
                                        <span className="text-zinc-300">{lineStr}</span>
                                    </div>
                                ))
                            ) : (
                                <span className="text-zinc-500 italic">No discovery trace available</span>
                            )}
                        </div>
                    </details>

                    <details className="group" open>
                        <summary className="cursor-pointer text-purple-500 hover:text-purple-300 transition-colors uppercase py-1 border-b border-purple-500/20 flex justify-between items-center">
                            <span className="flex items-center gap-2">
                                <Activity size={12} />
                                Intel Trace (Gemini)
                            </span>
                            <span className="group-open:rotate-180 transition-transform text-nano">▼</span>
                        </summary>
                        <div className="mt-2 space-y-1 bg-black/40 p-2 rounded border border-white/5 max-h-48 overflow-y-auto custom-scrollbar">
                            {debugData.pregameIntel?.ingest_trace ? (
                                debugData.pregameIntel.ingest_trace.map((lineStr: string, i: number) => (
                                    <div key={i} className="flex gap-2 text-nano">
                                        <span className="text-zinc-600 shrink-0 w-3">{i + 1}</span>
                                        <span className="text-zinc-300">{lineStr}</span>
                                    </div>
                                ))
                            ) : (
                                <span className="text-zinc-500 italic">No intel trace available</span>
                            )}
                        </div>
                    </details>

                    <details className="group" open>
                        <summary className="cursor-pointer text-cyan-400 hover:text-cyan-200 transition-colors uppercase py-1 border-b border-cyan-400/20 flex justify-between items-center">
                            <span className="flex items-center gap-2">
                                <Activity size={12} />
                                Chat Trace (The Architect)
                            </span>
                            <span className="group-open:rotate-180 transition-transform text-nano">▼</span>
                        </summary>
                        <div className="mt-2 space-y-1 bg-black/40 p-2 rounded border border-white/5 max-h-48 overflow-y-auto custom-scrollbar">
                            {debugData.activeConversation?.debug_trace ? (
                                debugData.activeConversation.debug_trace.map((lineStr: string, i: number) => (
                                    <div key={i} className="flex gap-2 text-nano">
                                        <span className="text-zinc-600 shrink-0 w-3">{i + 1}</span>
                                        <span className="text-zinc-300">{lineStr}</span>
                                    </div>
                                ))
                            ) : (
                                <span className="text-zinc-500 italic">No chat trace available</span>
                            )}
                        </div>
                    </details>
                </section>

                <div className="space-y-4">
                    <details className="group">
                        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors uppercase py-1 border-b border-white/5 flex justify-between">
                            <span>Ingest Trace (Last)</span>
                            <span className="group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <pre className="mt-2 p-2 bg-black/40 rounded overflow-x-auto text-nano max-h-48 overflow-y-auto border border-white/5">
                            {JSON.stringify(debugData.lastIngestDebug, null, 2)}
                        </pre>
                    </details>

                    <details className="group">
                        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors uppercase py-1 border-b border-white/5 flex justify-between">
                            <span>Raw Match Data</span>
                            <span className="group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <pre className="mt-2 p-2 bg-black/40 rounded overflow-x-auto text-nano max-h-48 overflow-y-auto border border-white/5">
                            {JSON.stringify(debugData.matchInDb, null, 2)}
                        </pre>
                    </details>

                    <details className="group">
                        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors uppercase py-1 border-b border-white/5 flex justify-between">
                            <span>Raw Market Feed</span>
                            <span className="group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <pre className="mt-2 p-2 bg-black/40 rounded overflow-x-auto text-nano max-h-48 overflow-y-auto border border-white/5">
                            {JSON.stringify(debugData.marketFeed, null, 2)}
                        </pre>
                    </details>

                    <details className="group">
                        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors uppercase py-1 border-b border-white/5 flex justify-between">
                            <span>Canonical Identity</span>
                            <span className="group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <pre className="mt-2 p-2 bg-black/40 rounded overflow-x-auto text-nano max-h-48 overflow-y-auto border border-white/5">
                            {JSON.stringify(debugData.canonicalGame, null, 2)}
                        </pre>
                    </details>

                    <details className="group">
                        <summary className="cursor-pointer text-purple-400 hover:text-purple-300 transition-colors uppercase py-1 border-b border-purple-500/20 flex justify-between">
                            <span>Full Market Feed (JSON)</span>
                            <span className="group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <pre className="mt-2 p-2 bg-black/40 rounded overflow-x-auto text-caption max-h-96 overflow-y-auto border border-purple-500/20 text-zinc-300 whitespace-pre">
                            {JSON.stringify(debugData.marketFeed, null, 2)}
                        </pre>
                    </details>
                </div>
            </div>

            <div className="p-4 border-t border-white/10 bg-zinc-900/30 text-nano text-zinc-600">
                SYSTEM_EPOCH: 2026-01-10T20:52:16Z
                <br />
                AGENT: ANTIGRAVITY_SRE_V2
            </div>
        </div>
    );
};

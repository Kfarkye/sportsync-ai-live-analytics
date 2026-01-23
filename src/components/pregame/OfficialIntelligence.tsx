import React from 'react';

interface Official {
    name: string;
    position: string;
}

interface RefIntelContent {
    crew?: string[];
    crewChief?: string;
    summary?: string;
    bettingTip?: string;
    recommendation?: string;
    crewName?: string;
    biasScore?: number;
    confidence?: number;
    homeTeamCompatibility?: number;
    awayTeamCompatibility?: number;
    overUnderTendency?: number;
    keyInsights?: string[];
    stats?: {
        foulRate?: string;
        underPct?: string;
        overPct?: string;
        homeWinPct?: string;
        pointsPerGame?: string;
        homeWinPctDiff?: string;
    };
    tendencies?: {
        name: string;
        impact: string;
    }[];
}

interface OfficialIntelligenceProps {
    officials: Official[];
    intel?: RefIntelContent | null;
}

const OfficialIntelligence: React.FC<OfficialIntelligenceProps> = ({ officials, intel }) => {
    if ((!officials || officials.length === 0) && !intel) return null;

    // Derived Display Data
    const chief = intel?.crewChief || ((officials && officials.length > 0) ? officials[0].name : intel?.crewName?.split(',')[0]?.trim());
    const crewMembers = (officials && officials.length > 0)
        ? officials.map(o => o.name)
        : (intel?.crewName ? intel.crewName.split(',').map(n => n.trim()) : []);

    return (
        <div className="relative">
            {/* Crew Chief Row */}
            <div className="py-5 border-b border-white/[0.04]">
                <div className="space-y-1">
                    <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em]">Crew Chief</span>
                    <h4 className="text-[14px] font-medium text-white tracking-tight">
                        {chief}
                    </h4>
                </div>
            </div>

            {/* Supporting Officials */}
            {crewMembers.length > 1 && (
                <div className="py-5 border-b border-white/[0.04]">
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">Crew</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {crewMembers.slice(1).map((name, idx) => (
                            <span key={idx} className="text-[12px] font-medium text-zinc-400">
                                {name}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OfficialIntelligence;

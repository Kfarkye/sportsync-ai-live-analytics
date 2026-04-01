
import React from 'react';
import { ShotEvent, Team } from '@/types';

interface HockeyRinkProps {
  shots: ShotEvent[];
  homeTeam: Team;
  awayTeam: Team;
}

const HockeyRink: React.FC<HockeyRinkProps> = ({ shots, homeTeam, awayTeam }) => {
  // NHL Rink Dimensions: 200ft x 85ft
  // API Coordinates: X goes from -100 to 100. Y goes from -42.5 to 42.5.
  // 0,0 is Center Ice.
  
  // SVG ViewBox: 0 0 200 85 (Simple mapping)
  // Transform: Scale X by 1, Y by 1. Translate 100, 42.5 to move origin to center.

  const mapX = (x: number) => x + 100;
  const mapY = (y: number) => 42.5 - y; // Flip Y axis because SVG Y grows downwards

  return (
    <div className="w-full relative aspect-[2.35/1]">
      <div className="absolute top-2 left-4 z-10 flex gap-4 text-caption font-bold font-mono bg-white/90 p-1 rounded border border-slate-200">
         <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{backgroundColor: homeTeam.color}}></div>
            <span className="text-slate-700">{homeTeam.shortName}</span>
         </div>
         <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{backgroundColor: awayTeam.color}}></div>
            <span className="text-slate-700">{awayTeam.shortName}</span>
         </div>
      </div>
      
      <svg viewBox="0 0 200 85" className="w-full h-full bg-slate-50 rounded-xl overflow-hidden">
        {/* Ice Surface */}
        <rect x="0" y="0" width="200" height="85" rx="15" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1" />
        
        {/* Center Line */}
        <line x1="100" y1="0" x2="100" y2="85" stroke="#ef4444" strokeWidth="1" />
        <circle cx="100" cy="42.5" r="15" fill="none" stroke="#ef4444" strokeWidth="1" />
        <circle cx="100" cy="42.5" r="1" fill="#ef4444" />

        {/* Blue Lines */}
        <line x1="75" y1="0" x2="75" y2="85" stroke="#3b82f6" strokeWidth="1" />
        <line x1="125" y1="0" x2="125" y2="85" stroke="#3b82f6" strokeWidth="1" />

        {/* Goal Lines */}
        <line x1="11" y1="0" x2="11" y2="85" stroke="#ef4444" strokeWidth="0.5" />
        <line x1="189" y1="0" x2="189" y2="85" stroke="#ef4444" strokeWidth="0.5" />

        {/* Creases */}
        <path d="M 11 38.5 A 4 4 0 0 1 11 46.5" fill="none" stroke="#ef4444" strokeWidth="0.5" />
        <path d="M 189 38.5 A 4 4 0 0 0 189 46.5" fill="none" stroke="#ef4444" strokeWidth="0.5" />

        {/* Faceoff Circles */}
        {/* Neutral Zone */}
        <circle cx="100" cy="42.5" r="15" fill="none" stroke="#ef4444" strokeWidth="0.5" opacity="0.2"/> 
        
        {/* Offensive/Defensive Zones */}
        {[31, 169].map(x => (
             <React.Fragment key={x}>
                <circle cx={x} cy="20.5" r="15" fill="none" stroke="#ef4444" strokeWidth="0.5" opacity="0.5" />
                <circle cx={x} cy="64.5" r="15" fill="none" stroke="#ef4444" strokeWidth="0.5" opacity="0.5" />
                <circle cx={x} cy="20.5" r="1" fill="#ef4444" opacity="0.5" />
                <circle cx={x} cy="64.5" r="1" fill="#ef4444" opacity="0.5" />
             </React.Fragment>
        ))}

        {/* Shots */}
        {shots.map(shot => {
             const cx = mapX(shot.x);
             const cy = mapY(shot.y);
             const color = shot.teamId === 'home' ? homeTeam.color : awayTeam.color;
             const isGoal = shot.type === 'goal';
             
             return (
                 <g key={shot.id} className="cursor-pointer group">
                     {isGoal ? (
                        <path 
                           d={`M ${cx} ${cy-2} L ${cx+2} ${cy+2} L ${cx-2} ${cy+2} Z`} 
                           fill={color} 
                           stroke="black" 
                           strokeWidth="0.5"
                           className="drop-shadow-sm hover:scale-150 transition-transform origin-center"
                        />
                     ) : (
                        <circle 
                           cx={cx} 
                           cy={cy} 
                           r={isGoal ? 2 : 1} 
                           fill={color} 
                           opacity={0.8}
                           stroke={isGoal ? "black" : "none"}
                           strokeWidth="0.5"
                           className="hover:r-2 transition-all"
                        />
                     )}
                     <title>{`${shot.type.toUpperCase()} - P${shot.period} ${shot.timeInPeriod}`}</title>
                 </g>
             )
        })}
      </svg>
    </div>
  );
};

export default HockeyRink;

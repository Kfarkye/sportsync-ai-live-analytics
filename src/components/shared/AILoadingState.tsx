
/**
 * AILoadingState - Sharp Edge AI Loading Component
 * Reusable across all AI analysis features
 */

import React from 'react';

type LoadingVariant = 'edge' | 'insight' | 'chat' | 'intel' | 'news';

interface AILoadingStateProps {
  variant?: LoadingVariant;
  message?: string;
  compact?: boolean;
}

const VARIANT_CONFIG: Record<LoadingVariant, { title: string; message: string; color: string }> = {
  edge: {
    title: 'Calculating Edge',
    message: 'Processing market data, injuries, situationals...',
    color: 'emerald',
  },
  insight: {
    title: 'Generating Insight',
    message: 'Analyzing game flow and betting angles...',
    color: 'emerald',
  },
  chat: {
    title: 'Thinking',
    message: 'Processing your question...',
    color: 'emerald',
  },
  intel: {
    title: 'Gathering Intel',
    message: 'Searching injury reports, lineups, weather...',
    color: 'blue',
  },
  news: {
    title: 'Scanning News',
    message: 'Checking latest team updates...',
    color: 'purple',
  },
};

const COLOR_MAP: Record<string, { border: string; glow: string; bg: string }> = {
  emerald: {
    border: 'border-t-emerald-500',
    glow: 'shadow-[0_0_15px_rgba(16,185,129,0.8)]',
    bg: 'bg-emerald-500',
  },
  blue: {
    border: 'border-t-blue-500',
    glow: 'shadow-[0_0_15px_rgba(59,130,246,0.8)]',
    bg: 'bg-blue-500',
  },
  purple: {
    border: 'border-t-purple-500',
    glow: 'shadow-[0_0_15px_rgba(168,85,247,0.8)]',
    bg: 'bg-purple-500',
  },
};

export const AILoadingState: React.FC<AILoadingStateProps> = ({ 
  variant = 'edge',
  message,
  compact = false,
}) => {
  const config = VARIANT_CONFIG[variant];
  const colors = COLOR_MAP[config.color] || COLOR_MAP.emerald;
  const displayMessage = message || config.message;

  // Compact inline version
  if (compact) {
    return (
      <div className="flex items-center gap-3 py-4 px-2">
        <div className="relative">
          <div className={`w-5 h-5 rounded-full border border-zinc-800 ${colors.border} animate-spin`} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`w-1 h-1 ${colors.bg} rounded-full animate-pulse`} />
          </div>
        </div>
        <span className="text-sm text-zinc-400 font-mono animate-pulse">
          {displayMessage}
        </span>
      </div>
    );
  }

  // Full centered version
  return (
    <div className="flex flex-col items-center justify-center w-full min-h-[400px] gap-8 animate-in fade-in duration-700">
      <div className="relative">
        {/* Outer ring */}
        <div className={`w-20 h-20 rounded-full border border-zinc-800 ${colors.border} animate-spin`} />
        {/* Inner ring - reverse spin */}
        <div 
          className="w-16 h-16 rounded-full border border-zinc-800 border-b-zinc-600 animate-spin absolute top-2 left-2" 
          style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} 
        />
        {/* Center dot with glow */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={`w-2 h-2 ${colors.bg} rounded-full ${colors.glow} animate-pulse`} />
        </div>
      </div>
      <div className="space-y-3 text-center max-w-md">
        <h3 className="text-xl font-bold text-white tracking-tight">
          {config.title}
        </h3>
        <p className="text-sm text-zinc-400 font-mono animate-pulse">
          {displayMessage}
        </p>
      </div>
    </div>
  );
};

export default AILoadingState;

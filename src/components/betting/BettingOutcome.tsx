import React, { memo, useMemo } from 'react';
import { Check, Minus } from 'lucide-react';

// ----------------------------------------------------------------------
// Types & Interfaces
// ----------------------------------------------------------------------

interface SpreadData {
  covered: boolean;
  teamId: string;
  line: string;
  isPush: boolean;
}

interface BettingOutcomeProps {
  /**
   * The spread data for the betting outcome.
   * Accepts null/undefined to handle safe rendering internally.
   */
  spread: SpreadData | null | undefined;
  /**
   * The ID of the team context in which this component is being rendered.
   * Used to determine if the current team covered the spread.
   */
  teamId: string;
}

// ----------------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------------

/**
 * Formats the spread line string, ensuring positive numbers have a '+' prefix.
 */
const formatSpreadLine = (line: string): string => {
  if (!line) return '';

  const numericLine = parseFloat(line);
  if (isNaN(numericLine)) return line;

  const hasPlus = line.includes('+');
  const isPositive = numericLine > 0;

  return isPositive && !hasPlus ? `+${line}` : line;
};

// ----------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------

const BettingOutcome = ({ spread, teamId }: BettingOutcomeProps) => {
  if (!spread) return null;

  const { teamId: coveringTeamId, line, isPush } = spread;

  const { isCoveringTeam, formattedLine } = useMemo(() => {
    return {
      isCoveringTeam: coveringTeamId === teamId,
      formattedLine: formatSpreadLine(line),
    };
  }, [coveringTeamId, teamId, line]);

  // Only render if the current team covered or it's a push
  if (!isCoveringTeam && !isPush) return null;

  const commonClasses =
    'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium font-mono tracking-tight transition-all duration-300';

  return (
    <div className="flex items-center mt-1">
      {isPush ? (
        <span
          className={`${commonClasses} bg-zinc-800 text-zinc-400 border border-zinc-700`}
        >
          <Minus className="w-3 h-3 text-zinc-500" />
          PUSH {line}
        </span>
      ) : (
        <span
          className={`${commonClasses} bg-emerald-950/30 text-emerald-400 border border-emerald-800/50`}
        >
          <Check className="w-3 h-3 stroke-[3px] text-emerald-500" />
          {formattedLine} COVER
        </span>
      )}
    </div>
  );
};

export default memo(BettingOutcome);

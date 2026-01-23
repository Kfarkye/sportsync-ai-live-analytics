
import React from 'react';
import { UnifiedMarket } from '../types';
import { CardShell } from '../../../components/ui/CardShell';
import { ShoppingCart, TrendingUp } from 'lucide-react';
import { cn } from '../../../lib/essence';

interface LineShoppingCardProps {
  market: UnifiedMarket | null;
  homeTeam: string;
  awayTeam: string;
}

const BookmakerBadge = ({ name }: { name: string }) => {
  let color = "bg-white/[0.04] text-zinc-400 border-white/[0.06]";
  const safeName = name || '';
  let label = safeName.substring(0, 3).toUpperCase();

  if (safeName.toLowerCase().includes('draftkings')) { color = "bg-[#53d337]/10 text-[#53d337] border-[#53d337]/20"; label = "DK"; }
  if (safeName.toLowerCase().includes('fanduel')) { color = "bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20"; label = "FD"; }
  if (safeName.toLowerCase().includes('pinnacle')) { color = "bg-[#ff6b00]/10 text-[#ff6b00] border-[#ff6b00]/20"; label = "PIN"; }

  return (
    <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded-[4px] border uppercase tracking-tighter", color)}>
      {label}
    </span>
  );
};

const BestLineCell = ({
  label,
  price,
  point,
  bookmaker
}: {
  label: string,
  price?: number,
  point?: number,
  bookmaker?: string
}) => {
  if (!price) return <div className="h-16 bg-white/[0.02] rounded-xl animate-pulse border border-white/[0.04]" />;

  const displayPrice = price > 0 ? `+${price}` : price;
  const displayPoint = point ? (point > 0 ? `+${point}` : point) : '';

  return (
    <div className="flex flex-col p-3 bg-gradient-to-b from-white/[0.04] to-transparent border border-white/[0.06] rounded-xl relative overflow-hidden group hover:border-emerald-500/30 transition-all active:scale-[0.98]">
      <div className="flex justify-between items-start mb-1.5">
        <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.1em] truncate max-w-[60%]">{label}</span>
        {bookmaker && <BookmakerBadge name={bookmaker} />}
      </div>
      <div className="flex items-baseline gap-2 relative z-10">
        <span className="text-[17px] font-mono font-bold text-white tracking-[-0.03em] tabular-nums">{displayPoint}</span>
        <span className="text-[13px] font-mono text-emerald-400 font-bold tabular-nums">
          {displayPrice}
        </span>
      </div>
      {/* Bottom Glow Strip */}
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
};

export const LineShoppingCard = ({ market, homeTeam, awayTeam }: LineShoppingCardProps) => {
  if (!market) return null;

  return (
    <CardShell className="p-0 bg-[#070707] border-white/[0.06] shadow-2xl overflow-hidden relative">
      {/* Ambient Gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.02] via-transparent to-transparent pointer-events-none" />

      <div className="px-6 py-4 border-b border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-md flex justify-between items-center relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <ShoppingCart size={13} className="text-emerald-400" />
          </div>
          <h3 className="text-[11px] font-black text-zinc-200 uppercase tracking-[0.2em] font-mono">
            Line Optimizer
          </h3>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
          <BestLineCell
            label={awayTeam}
            point={market.best_spread?.away?.point}
            price={market.best_spread?.away?.price}
            bookmaker={market.best_spread?.away?.bookmaker}
          />
          <span className="text-[10px] font-bold text-zinc-600 uppercase">Spread</span>
          <BestLineCell
            label={homeTeam}
            point={market.best_spread?.home?.point}
            price={market.best_spread?.home?.price}
            bookmaker={market.best_spread?.home?.bookmaker}
          />
        </div>

        <div className="grid grid-cols-[1fr_40px_1fr] gap-3 items-center">
          <BestLineCell
            label="Over"
            point={market.best_total?.over?.point}
            price={market.best_total?.over?.price}
            bookmaker={market.best_total?.over?.bookmaker}
          />
          <span className="text-[10px] font-black text-zinc-600 uppercase text-center tracking-widest opacity-40">O/U</span>
          <BestLineCell
            label="Under"
            point={market.best_total?.under?.point}
            price={market.best_total?.under?.price}
            bookmaker={market.best_total?.under?.bookmaker}
          />
        </div>

        {market.best_h2h && (
          <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
            <BestLineCell
              label={awayTeam}
              price={market.best_h2h.away?.price}
              bookmaker={market.best_h2h.away?.bookmaker}
            />
            <span className="text-[10px] font-bold text-zinc-600 uppercase">ML</span>
            <BestLineCell
              label={homeTeam}
              price={market.best_h2h.home?.price}
              bookmaker={market.best_h2h.home?.bookmaker}
            />
          </div>
        )}
      </div>

      <div className="px-5 py-2 border-t border-white/5 bg-[#080808] flex justify-between items-center">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600">
            Scanning {(market.bookmakers || []).length} Sportsbooks
          </span>
          {market.last_updated && (
            <span className="text-[7px] text-zinc-700 font-mono uppercase tracking-tighter">
              Last Scan: {new Date(market.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>
    </CardShell >
  );
};

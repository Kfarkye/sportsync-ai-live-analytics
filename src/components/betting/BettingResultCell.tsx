import React, { memo, useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/essence';
import { motion } from 'framer-motion';

interface Props {
  value?: string;
  label?: string;
  status?: 'winning' | 'losing' | 'push' | null;
  highlight?: boolean;
  className?: string;
}

const BettingResultCell = memo(({ value, label, status, highlight, className }: Props) => {
  const [flashClass, setFlashClass] = useState('');
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value && prevValue.current !== undefined) {
      setFlashClass('flash-update-green');
      const timer = setTimeout(() => setFlashClass(''), 1200);
      prevValue.current = value;
      return () => clearTimeout(timer);
    }
    prevValue.current = value;
  }, [value]);

  return (
    <motion.div
      whileTap={{ scale: 0.95 }}
      className={cn(
        "flex flex-col items-center justify-center p-4 rounded-[20px] transition-all duration-500",
        "glass-material", // Base material
        status === 'winning' ? "border-emerald-500/40 bg-emerald-500/[0.08] shadow-[0_0_20px_rgba(16,185,129,0.1)]" :
          status === 'losing' ? "opacity-30 grayscale border-white/[0.02]" :
            highlight ? "bg-slate-100 border-white/20" : "bg-white/40 border-slate-200",
        flashClass,
        className
      )}
    >
      {label && (
        <span className="text-[8px] font-black text-slate-500 uppercase tracking-[0.3em] mb-2 select-none">
          {label}
        </span>
      )}
      <span className={cn(
        "font-mono-ledger text-[18px] tracking-tighter leading-none",
        status === 'winning' ? "text-emerald-400 font-bold" : "text-slate-900 font-medium"
      )}>
        {value || '—'}
      </span>
    </motion.div>
  );
});

export default BettingResultCell;

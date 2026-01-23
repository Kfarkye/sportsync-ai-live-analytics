
import React from 'react';

interface SectionHeaderProps {
  title: string;
  count?: number;
  rightElement?: React.ReactNode;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, count, rightElement }) => {
  return (
    <div className="flex items-center justify-between py-3 px-4 lg:px-0 mt-6 mb-2 group">
      <div className="flex items-center gap-3 flex-1">
        <h3 className="text-[11px] font-bold text-white/50 uppercase tracking-[0.1em]">
          {title}
        </h3>
        {count !== undefined && count > 0 && (
          <span className="text-[11px] font-bold font-mono tabular-nums text-white/30 bg-white/[0.05] px-2 py-0.5 rounded-full">
            {count}
          </span>
        )}
        <div className="flex-1 h-px bg-gradient-to-r from-white/[0.08] to-transparent ml-2" />
      </div>
      {rightElement}
    </div>
  );
};

export default SectionHeader;

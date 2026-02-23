import React from 'react';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

const MotionButton = motion.button;

interface AnalysisTriggerProps {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  onClick: () => void;
  isActive: boolean;
  colorClass?: string; // Optional accent color for icon/glow
  isLoading?: boolean;
}

const AnalysisTrigger: React.FC<AnalysisTriggerProps> = ({ 
    title, 
    subtitle, 
    icon: Icon, 
    onClick, 
    isActive, 
    colorClass = "text-black",
    isLoading = false
}) => {
  return (
    <MotionButton
        onClick={onClick}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="w-full h-full min-h-[80px] group relative outline-none text-left"
    >
        <div className={`
            absolute inset-0 rounded-2xl transition-all duration-300
            ${isActive 
                ? 'bg-white opacity-100 shadow-[0_10px_30px_-10px_rgba(255,255,255,0.3)] border border-white' 
                : 'bg-surface-elevated border border-white/10 hover:bg-surface-subtle opacity-100'
            }
        `} />
        
        <div className="relative z-10 flex items-center justify-between p-4 h-full">
            <div className="flex items-center gap-3">
                <div className={`
                    w-10 h-10 rounded-xl flex items-center justify-center transition-colors
                    ${isActive ? 'bg-black/5 text-black' : 'bg-black border border-white/10 text-zinc-500 group-hover:text-white'}
                `}>
                    {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} className={isActive ? "" : ""} />}
                </div>
                
                <div>
                    <div className={`text-body-sm font-bold tracking-tight ${isActive ? 'text-black' : 'text-white'}`}>
                        {title}
                    </div>
                    <div className={`text-caption font-medium tracking-wide uppercase ${isActive ? 'text-black/60' : 'text-zinc-500'}`}>
                        {subtitle}
                    </div>
                </div>
            </div>
        </div>
    </MotionButton>
  );
};

export default AnalysisTrigger;
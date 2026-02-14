import React, { useState } from 'react';
import { X, Check, Zap, Target, Crown, Shield, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MotionDiv = motion.div;

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRICING_TIERS = [
  {
    id: 'rookie',
    name: 'Rookie',
    price: 'Free',
    period: 'forever',
    description: 'Essential public data for casual tracking.',
    features: [
      'Live Scores & Odds',
      'Basic Game Stats',
      'Public Money %',
      'Daily Free Pick'
    ],
    icon: Shield,
    accent: 'zinc'
  },
  {
    id: 'sharp',
    name: 'Sharp',
    price: '$29',
    period: 'per month',
    description: 'Advanced analytics for serious bettors.',
    features: [
      'Real-time Line Movement',
      'AI Edge Analysis (Unlimited)',
      'Sharp Money Indicators',
      'Prop Bet Finder',
      'Injury Impact Models'
    ],
    icon: Target,
    accent: 'emerald',
    popular: true
  },
  {
    id: 'whale',
    name: 'Whale',
    price: '$99',
    period: 'per month',
    description: 'Institutional-grade data feeds & API access.',
    features: [
      'Direct API Access',
      '0ms Latency Feeds',
      'Personalized Model Builders',
      'Dedicated Account Manager',
      'Private Discord Access'
    ],
    icon: Crown,
    accent: 'violet'
  }
];

const PricingModal: React.FC<PricingModalProps> = ({ isOpen, onClose }) => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  if (!isOpen) return null;

  return (
    <AnimatePresence>
        {isOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <MotionDiv 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/80 backdrop-blur-xl" 
                    onClick={onClose} 
                />
                
                <MotionDiv 
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="relative bg-[#111113] border border-white/10 w-full max-w-5xl rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
                >
                    {/* Header */}
                    <div className="relative flex flex-col items-center justify-center pt-10 pb-6 px-6 border-b border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent">
                        <button 
                            onClick={onClose} 
                            className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                                <Zap size={16} className="text-white fill-white" />
                            </div>
                            <span className="text-sm font-bold text-white tracking-widest uppercase">The Drip Pro</span>
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight text-center mb-6">
                            Upgrade Your Edge
                        </h2>

                        {/* Toggle */}
                        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-full border border-white/5 relative">
                            <button 
                                onClick={() => setBillingCycle('monthly')}
                                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all relative z-10 ${billingCycle === 'monthly' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                Monthly
                            </button>
                            <button 
                                onClick={() => setBillingCycle('yearly')}
                                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all relative z-10 flex items-center gap-2 ${billingCycle === 'yearly' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                Yearly <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">-20%</span>
                            </button>
                            
                            {/* Sliding pill */}
                            <MotionDiv 
                                layout
                                className="absolute top-1 bottom-1 w-[80px] bg-white/10 rounded-full border border-white/5 shadow-inner"
                                initial={false}
                                animate={{ left: billingCycle === 'monthly' ? 4 : 88, width: billingCycle === 'monthly' ? 82 : 110 }}
                                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                            />
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar bg-[#111113]">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {PRICING_TIERS.map((tier) => {
                                const Icon = tier.icon;
                                const isPopular = tier.popular;
                                
                                // Dynamic Styles based on tier
                                const borderClass = isPopular ? 'border-emerald-500/30' : 'border-white/10';
                                const bgClass = isPopular ? 'bg-gradient-to-b from-emerald-950/20 to-transparent' : 'bg-white/[0.02]';
                                const btnClass = isPopular 
                                    ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/20' 
                                    : 'bg-white/10 hover:bg-white/20 text-white';

                                return (
                                    <div 
                                        key={tier.id}
                                        className={`
                                            relative rounded-3xl p-6 border flex flex-col transition-all duration-300 group
                                            ${borderClass} ${bgClass}
                                            hover:border-white/20 hover:bg-white/[0.04]
                                        `}
                                    >
                                        {isPopular && (
                                            <div className="absolute -top-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-50" />
                                        )}

                                        <div className="mb-6">
                                            <div className="flex justify-between items-start mb-4">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isPopular ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-zinc-400'}`}>
                                                    <Icon size={20} />
                                                </div>
                                                {isPopular && (
                                                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full uppercase tracking-wider border border-emerald-500/20">
                                                        Best Value
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="text-lg font-bold text-white mb-1">{tier.name}</h3>
                                            <p className="text-xs text-zinc-400 h-8 leading-relaxed">{tier.description}</p>
                                        </div>

                                        <div className="mb-8">
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-3xl font-bold text-white tracking-tight">{tier.price}</span>
                                                {tier.price !== 'Free' && <span className="text-zinc-500 text-sm">{tier.period}</span>}
                                            </div>
                                        </div>

                                        <div className="space-y-3 flex-1 mb-8">
                                            {tier.features.map((feat, i) => (
                                                <div key={i} className="flex items-start gap-3 text-sm">
                                                    <Check size={16} className={`shrink-0 mt-0.5 ${isPopular ? 'text-emerald-400' : 'text-zinc-600'}`} strokeWidth={3} />
                                                    <span className="text-zinc-300">{feat}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <button 
                                            className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-200 active:scale-95 flex items-center justify-center gap-2 ${btnClass}`}
                                        >
                                            {tier.id === 'rookie' ? 'Current Plan' : `Select ${tier.name}`}
                                            {tier.id !== 'rookie' && <ArrowRight size={16} />}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                        
                        <div className="mt-12 flex flex-col items-center justify-center text-center gap-4">
                            <div className="flex -space-x-2">
                                {[1,2,3,4].map(i => (
                                    <div key={i} className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-[#050505] flex items-center justify-center text-[10px] text-zinc-400">
                                        User
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-zinc-500">
                                Trusted by 10,000+ sharps. Cancel anytime. Secure payment via Stripe.
                            </p>
                        </div>
                    </div>
                </MotionDiv>
            </div>
        )}
    </AnimatePresence>
  );
};

export default PricingModal;
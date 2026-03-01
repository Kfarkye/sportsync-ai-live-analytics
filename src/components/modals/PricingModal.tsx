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
                    className="absolute inset-0 bg-zinc-950/55 backdrop-blur-[2px]" 
                    onClick={onClose} 
                />
                
                <MotionDiv 
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[32px] border border-zinc-200 bg-white shadow-[0_26px_70px_rgba(15,23,42,0.2)]"
                >
                    {/* Header */}
                    <div className="relative flex flex-col items-center justify-center border-b border-zinc-200 bg-gradient-to-b from-zinc-50 to-white px-6 pb-6 pt-10">
                        <button 
                            onClick={onClose} 
                            className="absolute right-5 top-5 rounded-full border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
                        >
                            <X size={20} />
                        </button>

                        <div className="flex items-center gap-2 mb-4">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-zinc-900 to-zinc-700 shadow-sm shadow-zinc-900/25">
                                <Zap size={16} className="text-white" />
                            </div>
                            <span className="text-sm font-bold tracking-widest uppercase text-zinc-900">The Drip Pro</span>
                        </div>
                        <h2 className="mb-6 text-center text-3xl font-bold tracking-tight text-zinc-900 md:text-4xl">
                            Upgrade Your Edge
                        </h2>

                        {/* Toggle */}
                        <div className="relative flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 p-1">
                            <button 
                                onClick={() => setBillingCycle('monthly')}
                                className={`relative z-10 rounded-full px-4 py-1.5 text-xs font-bold transition-all ${billingCycle === 'monthly' ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
                            >
                                Monthly
                            </button>
                            <button 
                                onClick={() => setBillingCycle('yearly')}
                                className={`relative z-10 flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold transition-all ${billingCycle === 'yearly' ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
                            >
                                Yearly <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] text-emerald-700">-20%</span>
                            </button>
                            
                            {/* Sliding pill */}
                            <MotionDiv 
                                layout
                                className="absolute bottom-1 top-1 w-[80px] rounded-full border border-zinc-200 bg-white shadow-sm"
                                initial={false}
                                animate={{ left: billingCycle === 'monthly' ? 4 : 88, width: billingCycle === 'monthly' ? 82 : 110 }}
                                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                            />
                        </div>
                    </div>

                    {/* Content */}
                    <div className="custom-scrollbar flex-1 overflow-y-auto bg-zinc-50/40 p-6 md:p-10">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {PRICING_TIERS.map((tier) => {
                                const Icon = tier.icon;
                                const isPopular = tier.popular;
                                
                                // Dynamic Styles based on tier
                                const borderClass = isPopular ? 'border-emerald-300' : 'border-zinc-200';
                                const bgClass = isPopular ? 'bg-gradient-to-b from-emerald-50 to-white' : 'bg-white';
                                const btnClass = isPopular 
                                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/20' 
                                    : 'bg-zinc-900 hover:bg-zinc-800 text-white';

                                return (
                                    <div 
                                        key={tier.id}
                                        className={`
                                            group relative flex flex-col rounded-3xl border p-6 transition-all duration-300
                                            ${borderClass} ${bgClass}
                                            hover:-translate-y-0.5 hover:shadow-[0_18px_30px_rgba(15,23,42,0.08)]
                                        `}
                                    >
                                        {isPopular && (
                                            <div className="absolute -top-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-60" />
                                        )}

                                        <div className="mb-6">
                                            <div className="flex justify-between items-start mb-4">
                                                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isPopular ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
                                                    <Icon size={20} />
                                                </div>
                                                {isPopular && (
                                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                                                        Best Value
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="mb-1 text-lg font-bold text-zinc-900">{tier.name}</h3>
                                            <p className="h-8 text-xs leading-relaxed text-zinc-600">{tier.description}</p>
                                        </div>

                                        <div className="mb-8">
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-3xl font-bold tracking-tight text-zinc-900">{tier.price}</span>
                                                {tier.price !== 'Free' && <span className="text-sm text-zinc-600">{tier.period}</span>}
                                            </div>
                                        </div>

                                        <div className="space-y-3 flex-1 mb-8">
                                            {tier.features.map((feat, i) => (
                                                <div key={i} className="flex items-start gap-3 text-sm">
                                                    <Check size={16} className={`shrink-0 mt-0.5 ${isPopular ? 'text-emerald-700' : 'text-zinc-600'}`} strokeWidth={3} />
                                                    <span className="text-zinc-700">{feat}</span>
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
                        
                        <div className="mt-12 flex flex-col items-center justify-center gap-4 text-center">
                            <div className="flex -space-x-2">
                                {[1,2,3,4].map(i => (
                                    <div key={i} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-zinc-200 text-[10px] text-zinc-600">
                                        User
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-zinc-600">
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

import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { cn, ESSENCE } from '@/lib/essence';

const MotionDiv = motion.div;

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  variant?: 'default' | 'glass' | 'solid' | 'elevated' | 'flush';
  hover?: boolean;
  livePulse?: boolean;
  isLoading?: boolean;
  noPadding?: boolean;
  className?: string;
}

const CARD_VARIANTS: Record<NonNullable<CardProps['variant']>, string> = {
  default: ESSENCE.card.base,
  glass: cn('backdrop-blur-xl', ESSENCE.tw.surface.subtle, ESSENCE.tw.border.default, ESSENCE.card.radius),
  solid: cn('bg-white', ESSENCE.tw.border.default, ESSENCE.card.radius),
  elevated: cn('bg-white', ESSENCE.tw.border.default, ESSENCE.card.radius, 'shadow-sm'),
  flush: 'bg-transparent border-0 rounded-none',
};

export const Card = memo(({
  children,
  className,
  variant = 'default',
  hover = false,
  livePulse = false,
  isLoading = false,
  noPadding = false,
  ...rest
}: CardProps) => {
  return (
    <MotionDiv
      className={cn(
        'relative overflow-hidden transition-all duration-300',
        ESSENCE.card.radius,
        CARD_VARIANTS[variant],
        hover && 'hover:-translate-y-0.5 hover:border-slate-300',
        !noPadding && variant !== 'flush' && ESSENCE.card.padding,
        className
      )}
      {...rest}
    >
      {livePulse && (
        <div
          className="absolute top-0 left-0 right-0 h-px z-20 motion-safe:animate-pulse"
          style={{ background: ESSENCE.colors.accent.success }}
        />
      )}

      {isLoading && (
        <div className="absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(15,23,42,0.06) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s infinite',
            }}
          />
        </div>
      )}

      <div className={cn('relative z-10 h-full', isLoading && 'opacity-0')}>{children}</div>
    </MotionDiv>
  );
});

Card.displayName = 'Card';

export default Card;

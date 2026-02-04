import { useState, useEffect, useRef } from 'react';
import type { Variants } from 'framer-motion';

/**
 * useValueFlash - Core institutional hook for "Value-at-Risk" highlighting.
 * Returns a variant name for Framer Motion to animate a pulse when values change.
 */
export const useValueFlash = <T,>(value: T, duration = 1500) => {
    const [isFlashing, setIsFlashing] = useState(false);
    const prevValue = useRef(value);

    useEffect(() => {
        if (prevValue.current !== undefined && prevValue.current !== value) {
            setIsFlashing(true);
            const timer = setTimeout(() => setIsFlashing(false), duration);
            prevValue.current = value;
            return () => clearTimeout(timer);
        }
        prevValue.current = value;
    }, [value, duration]);

    return isFlashing;
};

/**
 * Institutional Flash Animation Variants
 */
export const institutionalFlashVariants: Variants = {
    initial: { backgroundColor: 'transparent' },
    flash: (color = 'rgba(52, 211, 153, 0.4)') => ({
        backgroundColor: [
            'transparent',
            color,
            'rgba(52, 211, 153, 0.1)', // linger
            'transparent'
        ],
        transition: {
            duration: 0.8, // Faster, snappier
            times: [0, 0.1, 0.4, 1], // Impact then fade
            ease: "easeOut"
        }
    })
};


// ============================================================================
// ESSENCE DESIGN SYSTEM v6.0 (Project Ive / Physics)
// "Inevitability, Physics, continuous curves"
// ============================================================================

export const ESSENCE = {
  colors: {
    Obsidian: {
      Base: '#000000',     // True Black
      Surface: '#09090B',  // Zinc 950
      Glass: 'rgba(20, 20, 22, 0.65)', // Translucent
    },
    Neon: {
      Cyan: '#00F0FF',
      Magenta: '#FF003C',
      Amber: '#F59E0B',
      Green: '#10B981',
    }
  },
  // Multi-layered shadows for realistic depth
  shadows: {
    subtle: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    float: '0 10px 40px -10px rgba(0,0,0,0.5)',
    deep: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
    glow: (color: string) => `0 0 20px ${color}15, 0 0 4px ${color}40`,
  },
  // Apple-style spring physics
  transition: {
    spring: {
      type: "spring",
      stiffness: 350,
      damping: 25,
      mass: 1
    },
    soft: {
      type: "spring",
      stiffness: 200,
      damping: 30
    },
    instant: {
      duration: 0.15,
      ease: [0.25, 0.1, 0.25, 1.0]
    }
  },
  glass: {
    panel: 'backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); background-color: rgba(10, 10, 12, 0.75); border: 1px solid rgba(255,255,255,0.06);',
  }
} as const;

export const cn = (...classes: (string | undefined | null | false)[]) =>
  classes.filter(Boolean).join(' ');

export default ESSENCE;

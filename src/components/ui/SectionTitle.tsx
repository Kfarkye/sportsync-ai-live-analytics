
import React from "react";
import { SectionHeader } from "./SectionHeader";

/**
 * SectionTitle - Backwards-Compatible Alias
 * 
 * This component is preserved for existing imports.
 * All new code should use SectionHeader directly.
 * 
 * @deprecated Use SectionHeader from ./SectionHeader.tsx instead
 */
interface SectionTitleProps {
  children?: React.ReactNode;
  className?: string;
  accent?: 'default' | 'live' | 'final';
}

export const SectionTitle = ({ children, className, accent = 'default' }: SectionTitleProps) => {
  return (
    <SectionHeader accent={accent} className={className}>
      {children}
    </SectionHeader>
  );
};

export default SectionTitle;

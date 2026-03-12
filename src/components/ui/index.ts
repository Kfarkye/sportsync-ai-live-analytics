/**
 * UI Primitives Barrel Export
 * 
 * UNIFIED DESIGN SYSTEM v10.0
 * All UI primitives are exported from this single location.
 */

// Core Layout
export { Card } from './Card';
export { default as CardDefault } from './Card';
export { Page } from './Page';
export { default as PageDefault } from './Page';

// Headers & Titles
export { PageHeader } from './PageHeader';
export { SectionHeader, CardHeader } from './SectionHeader';
export { Pill } from './Pill';
export { default as PillDefault } from './Pill';
export { TableRail } from './TableRail';
export { default as TableRailDefault } from './TableRail';
export { FilterBar } from './FilterBar';
export { DataTable } from './DataTable';
export { SummaryStrip } from './SummaryStrip';
export type { DataTableColumn, DataTableDensity, DataTableRowTone } from './DataTable';
export type { SummaryStripItem } from './SummaryStrip';

// Status Indicators
export { StatusChip } from './StatusChip';
export { default as StatusChipDefault } from './StatusChip';

// Utility
export { EmptyState } from './EmptyState';
export { PropViewToggle } from './PropViewToggle';
export { MatchupLoader } from './MatchupLoader';
export { MatchupError } from './MatchupError';
export { MatchupContextPills } from './MatchupContextPills';

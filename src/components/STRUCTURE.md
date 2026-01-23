# Component Architecture

This directory is organized by functional domain to ensure scalability and maintainability.

## 📂 Directory Structure

### `layout/`
Core application shell and navigation components.
- `AppShell`: Main layout wrapper
- `UnifiedHeader`: Top navigation
- `Sidebar`, `MobileNavBar`: Navigation menus

### `match/`
Components related to match display and lists.
- `MatchList`: Main feed visualizer
- `MatchCard`: Individual match summary
- `MatchDetails`: Detailed match view (incorporating sub-features)

### `betting/`
Betting-specific functionality and widgets.
- `BetSlipDrawer`: User bet management
- `OddsCard`: Betting lines display
- `SharpSignalWidget`: smart money indicators

### `analysis/`
Deep data visualization and intelligence tools.
- `LiveDashboard`: Real-time analytics view
- `NewsIntelCard`: AI-driven match intelligence
- `MomentumChart`: Live game momentum visualization
- `Gamecast`: Live game tracking

### `modals/`
Overlay components for user interaction.
- `AuthModal`, `SettingsModal`, `PricingModal`
- `CommandPalette`: Global search & action

### `shared/`
Reusable UI atoms and molecules.
- `TeamLogo`: Standardized team branding

### `pregame/`
Pre-match specific analysis and widgets.

---

## 📐 Design Guidelines
- **Typography First**: Avoid decorative icons; use weight/color for hierarchy.
- **Strict Typing**: All components must be typed with strict TS interfaces.
- **Composition**: Prefer small, focused components over monolithic files.

/** Mainline scrim: a soft void wash behind dialogs and sheets, blurred, with fade in/out. */
export const overlayScrim =
  "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";

/** Dialog / sheet panel: panel fill, hairline rail, ink — same type scale as the page. */
export const dialogSurface =
  "rounded-lg border border-border bg-card text-foreground shadow-none";

/** Floating panel chrome: panel fill, hairline rail, ink text — for tooltips and menus. */
export const popoverSurface =
  "border border-border bg-popover text-popover-foreground";
/** Compact identity chip (avatar / overview-row): panel-2 fill, rail-lit hairline, mut mono. */
export const panelChip =
  "border border-[hsl(var(--rail-lit))] bg-secondary font-mono text-muted-foreground";

/** Top-bar live status pill — rail hairline, mono 11px, muted ink (design-system `.livechip`). */
export const liveChip =
  "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground";

/** Current-hue live glow — arbitrary property so Tailwind emits box-shadow, not a shadow color. */
export const currentGlow = "[box-shadow:var(--glow)]";

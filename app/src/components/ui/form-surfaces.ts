/** Quiet chrome: panel fill, hairline rail, token focus ring. */
export const formControlSurface =
  "border border-input bg-card text-foreground shadow-none transition-colors placeholder:text-muted-foreground hover:border-[hsl(var(--rail-lit))] focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

/** Shared Mainline chrome for Checkbox / Switch roots. */
export const toggleControlSurface =
  "border border-input bg-card shadow-none transition-colors hover:border-[hsl(var(--rail-lit))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary";

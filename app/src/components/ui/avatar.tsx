import * as React from "react";
import { cn } from "@/lib/utils/cn";
import {
  currentGlow,
  panelChip,
} from "@/components/ui/overlay-surfaces";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const sizeClasses = {
  sm: "h-[18px] w-[18px] text-[9px]",
  md: "h-[22px] w-[22px] text-[10px]",
  lg: "h-7 w-7 text-xs",
} as const;

export type AvatarSize = keyof typeof sizeClasses;

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: AvatarSize;
  /** When true, draw the current-hue live glow. */
  live?: boolean;
}

/** Known model/agent families → single-letter avatar initial. */
const MODEL_FAMILY_INITIALS: Record<string, string> = {
  composer: "C",
  grok: "G",
  opus: "O",
};

function modelFamilyInitial(name: string): string | undefined {
  const parts = name
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .split(/[\s._-]+/)
    .filter(Boolean);
  for (const part of parts) {
    const initial = MODEL_FAMILY_INITIALS[part];
    if (initial) return initial;
  }
  return undefined;
}

/** Initials for a display name: model family letter, else two letters or first+last word initials. */
export function initialsFromName(name: string): string {
  const model = modelFamilyInitial(name);
  if (model) return model;

  const parts = name
    .trim()
    .replace(/^@+/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Panel-chip initials avatar; full name via Tooltip; optional current glow when live. */
export function Avatar({
  name,
  size = "md",
  live = false,
  className,
  ...props
}: AvatarProps) {
  const initials = initialsFromName(name);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={name}
          {...props}
          className={cn(
            "inline-flex shrink-0 select-none items-center justify-center rounded-full",
            panelChip,
            sizeClasses[size],
            live && currentGlow,
            className,
          )}
        >
          {initials}
        </span>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

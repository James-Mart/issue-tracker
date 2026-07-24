import type {
  EpicStatus,
  RetroStatus,
  SpecReviewStatus,
  StoryStatus,
} from "@server/schemas";
import type { BadgeProps } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import {
  EPIC_STATUS_BADGE_VARIANT,
  EPIC_STATUS_LABEL,
  RETRO_BADGE_VARIANT,
  RETRO_LABEL,
  SPEC_REVIEW_BADGE_VARIANT,
  SPEC_REVIEW_LABEL,
  STORY_STATUS_BADGE_VARIANT,
  STORY_STATUS_LABEL,
} from "../lib/derived";

export type AxisChip = {
  variant: NonNullable<BadgeProps["variant"]>;
  label: string;
  prefix?: string;
};

/** Shared status/axis chip row (status, specReview, retro, …). */
export function AxisChips({
  chips,
  className,
}: {
  chips: AxisChip[];
  className?: string;
}) {
  if (chips.length === 0) return null;

  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      {chips.map((chip) => {
        const key = chip.prefix
          ? `${chip.prefix}:${chip.label}`
          : chip.label;
        return (
          <Badge key={key} variant={chip.variant}>
            {chip.prefix ? `${chip.prefix}: ${chip.label}` : chip.label}
          </Badge>
        );
      })}
    </span>
  );
}

export function storyAxesVisible(
  storyStatus?: StoryStatus,
  specReview?: SpecReviewStatus,
  retro?: RetroStatus,
) {
  return Boolean(storyStatus || specReview || retro);
}

export function StoryAxisChips({
  storyStatus,
  specReview,
  retro,
  className,
}: {
  storyStatus?: StoryStatus;
  specReview?: SpecReviewStatus;
  retro?: RetroStatus;
  className?: string;
}) {
  const chips: AxisChip[] = [];
  if (storyStatus) {
    chips.push({
      variant: STORY_STATUS_BADGE_VARIANT[storyStatus],
      label: STORY_STATUS_LABEL[storyStatus],
    });
  }
  if (specReview) {
    chips.push({
      variant: SPEC_REVIEW_BADGE_VARIANT[specReview],
      label: SPEC_REVIEW_LABEL[specReview],
      prefix: "specReview",
    });
  }
  if (retro) {
    chips.push({
      variant: RETRO_BADGE_VARIANT[retro],
      label: RETRO_LABEL[retro],
      prefix: "retro",
    });
  }
  return <AxisChips chips={chips} className={className} />;
}

export function epicAxesVisible(epicStatus?: EpicStatus, retro?: RetroStatus) {
  return Boolean(epicStatus || retro);
}

export function EpicAxisChips({
  epicStatus,
  retro,
  className,
}: {
  epicStatus?: EpicStatus;
  retro?: RetroStatus;
  className?: string;
}) {
  const chips: AxisChip[] = [];
  if (epicStatus) {
    chips.push({
      variant: EPIC_STATUS_BADGE_VARIANT[epicStatus],
      label: EPIC_STATUS_LABEL[epicStatus],
    });
  }
  if (retro) {
    chips.push({
      variant: RETRO_BADGE_VARIANT[retro],
      label: RETRO_LABEL[retro],
      prefix: "retro",
    });
  }
  return <AxisChips chips={chips} className={className} />;
}

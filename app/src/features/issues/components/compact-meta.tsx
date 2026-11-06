import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { MetaRow } from "./meta-row";

/** One label/value pair in the compact meta block (aligned with MetaRow). */
export function CompactMetaItem({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return <MetaRow label={label} value={value} className={className} />;
}

/** Single aligned metadata block (not a stack of separate cards). */
export function CompactMetaBlock({
  children,
  className,
  dataRegion = "meta-scalars",
}: {
  children: ReactNode;
  className?: string;
  /** Region id for tests / diagnostics; still one block even when it holds editable + fixed rows. */
  dataRegion?: string;
}) {
  return (
    <div
      data-region={dataRegion}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3.5 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ReviewIdentity({
  title,
  id,
  missing,
}: {
  title: string;
  id: string;
  missing?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span
        className={
          missing
            ? "truncate font-medium text-[hsl(var(--blocked))]"
            : "truncate font-medium text-foreground"
        }
      >
        {title}
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{id}</span>
    </div>
  );
}

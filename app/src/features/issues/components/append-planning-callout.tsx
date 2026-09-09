import { DetailEyebrow } from "./detail-section";

/** States what planning will do when a valid append target is set. */
export function AppendPlanningCallout({ storyTitle }: { storyTitle: string }) {
  return (
    <section
      data-testid="append-planning-callout"
      className="flex flex-col rounded-lg border border-border bg-card px-4 py-3.5"
    >
      <DetailEyebrow className="mb-2.5">Append planning</DetailEyebrow>
      <p
        data-testid="append-planning-callout-copy"
        className="text-sm leading-relaxed text-muted-foreground"
      >
        Planning this Idea will append resulting Tasks to{" "}
        <strong className="font-medium text-foreground">{storyTitle}</strong>{" "}
        instead of creating a new root Story.
      </p>
    </section>
  );
}

/** Session title for a Vision refinement conversation on a Project. */
export function visionSessionTitle(): string {
  return "Vision refinement";
}

/** First prompt naming the Project id and vision-docs skill to load. */
export function visionSessionMessage(projectId: string): string {
  return (
    `Refine vision for ${projectId} in the issue tracker ` +
    "using the issue-tracker-vision-docs skill."
  );
}

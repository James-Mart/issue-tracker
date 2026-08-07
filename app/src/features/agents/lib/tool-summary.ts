export type ToolSummary = { label: string; detail: string | null };

const DETAIL_MAX = 80;

function truncateDetail(value: string): string {
  return value.length <= DETAIL_MAX ? value : value.slice(0, DETAIL_MAX);
}

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** One-line preview for collapsed thinking blocks (same 80-char budget as tool detail). */
export function thinkingPreview(text: string): string | null {
  const line = firstNonEmptyLine(text);
  return line ? truncateDetail(line) : null;
}

function shortenPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 2) return path;
  return segments.slice(-2).join("/");
}

function pathDetail(path: unknown): string | null {
  if (typeof path !== "string" || !path) return null;
  return truncateDetail(shortenPath(path));
}

function firstStringDetail(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  for (const key of Object.keys(args)) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === "string") {
      return truncateDetail(value);
    }
  }
  return null;
}

const TOOL_SUMMARIZERS: Record<
  string,
  (args: Record<string, unknown>) => string | null
> = {
  shell: (args) =>
    typeof args.command === "string" ? truncateDetail(args.command) : null,
  read: (args) => pathDetail(args.path),
  edit: (args) => pathDetail(args.path),
  delete: (args) => pathDetail(args.path),
  grep: (args) => {
    const pattern =
      typeof args.pattern === "string" ? args.pattern : null;
    const scope =
      typeof args.glob === "string"
        ? args.glob
        : typeof args.path === "string"
          ? shortenPath(args.path)
          : null;
    if (!pattern) return scope ? truncateDetail(scope) : null;
    if (!scope) return truncateDetail(pattern);
    return truncateDetail(`${pattern} in ${scope}`);
  },
  glob: (args) => {
    const pattern =
      typeof args.globPattern === "string" ? args.globPattern : null;
    const dir =
      typeof args.targetDirectory === "string"
        ? shortenPath(args.targetDirectory)
        : null;
    if (!pattern) return dir ? truncateDetail(dir) : null;
    if (!dir) return truncateDetail(pattern);
    return truncateDetail(`${pattern} in ${dir}`);
  },
  readlints: (args) => {
    const paths = args.paths;
    if (!Array.isArray(paths) || paths.length === 0) return null;
    const shortened = paths
      .filter((p): p is string => typeof p === "string")
      .map(shortenPath);
    return truncateDetail(shortened.join(", "));
  },
  updatetodos: (args) => {
    const todos = args.todos;
    if (!Array.isArray(todos)) return null;
    const count = todos.length;
    return truncateDetail(`${count} todo${count === 1 ? "" : "s"}`);
  },
  createplan: (args) => {
    const plan = args.plan;
    if (typeof plan !== "string" || !plan) return null;
    const firstLine = plan.split("\n")[0]?.trim();
    return firstLine ? truncateDetail(firstLine) : null;
  },
  mcp: (args) => {
    const provider =
      typeof args.providerIdentifier === "string"
        ? args.providerIdentifier
        : null;
    const tool = typeof args.toolName === "string" ? args.toolName : null;
    if (provider && tool) return truncateDetail(`${provider}/${tool}`);
    if (provider) return truncateDetail(provider);
    if (tool) return truncateDetail(tool);
    return null;
  },
};

export function summarizeToolCall(
  name: string | null | undefined,
  args: unknown,
): ToolSummary {
  const trimmed = name?.trim();
  const label = trimmed || "tool";
  let detail: string | null = null;
  if (typeof args === "object" && args !== null) {
    const summarizer = TOOL_SUMMARIZERS[label.toLowerCase()];
    detail = summarizer
      ? summarizer(args as Record<string, unknown>)
      : firstStringDetail(args);
  }
  return { label, detail };
}

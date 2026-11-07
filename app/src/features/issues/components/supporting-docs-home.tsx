import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  isSupportingDocKey,
  type SupportingDocKey,
} from "@server/issue-constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import { locationWithSearch, supportingDocSearch } from "../lib/project-home";
import type { SupportingDocPreviewTab } from "../lib/supporting-docs";
import { SupportingDocPreview } from "./supporting-doc-preview";

/**
 * Supporting docs peer: a document list beside the preview from 860px up,
 * and a compact selector above the preview below that. The preview is on
 * screen in both layouts.
 */
export function SupportingDocsHome({
  projectId,
  docs,
  selected,
  searchParams,
}: {
  projectId: string;
  docs: readonly SupportingDocPreviewTab[];
  selected: SupportingDocPreviewTab;
  searchParams: URLSearchParams;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const supportingDocLocation = (key: SupportingDocKey) =>
    locationWithSearch(location, supportingDocSearch(searchParams, key));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 shell:flex-row shell:items-stretch shell:gap-4">
      <nav
        aria-label="Supporting documents"
        className="hidden w-52 shrink-0 self-start shell:block"
      >
        <ul className="rounded-lg border border-border p-1">
          {docs.map((doc) => {
            const current = doc.key === selected.key;
            return (
              <li key={doc.key}>
                <Link
                  to={supportingDocLocation(doc.key)}
                  replace
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11",
                    current
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {doc.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="w-full shrink-0 shell:hidden">
        <Select
          value={selected.key}
          onValueChange={(value) => {
            if (!isSupportingDocKey(value)) {
              throw new Error(`Unknown supporting document: ${value}`);
            }
            navigate(supportingDocLocation(value), { replace: true });
          }}
        >
          <SelectTrigger
            aria-label="Supporting document"
            className="w-full touch:min-h-11"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {docs.map((doc) => (
              <SelectItem key={doc.key} value={doc.key}>
                {doc.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          selected.format === "html" ? "" : "overflow-y-auto",
        )}
      >
        <SupportingDocPreview projectId={projectId} tab={selected} />
      </div>
    </div>
  );
}

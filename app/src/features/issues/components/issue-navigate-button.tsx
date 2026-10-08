import type { MouseEvent, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IssueLinkResolution } from "../hooks/use-supplemented-by-id";
import {
  useBoundNavigate,
  useIssueLinkNavigate,
  type IssueSupplement,
} from "./issue-link";

function NavigateButton({
  id,
  onClick,
  go,
  resolution,
}: {
  id: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  go: (targetId: string) => void;
  resolution: ReactNode;
}) {
  return (
    <>
      {resolution}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={`Open ${id}`}
        className="shrink-0 text-muted-foreground"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick?.(event);
          go(id);
        }}
      >
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}

function IssueNavigateOwned({
  id,
  onClick,
}: {
  id: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const nav = useIssueLinkNavigate(id);
  return (
    <NavigateButton
      id={id}
      onClick={onClick}
      go={nav.go}
      resolution={
        <IssueLinkResolution
          missingIds={nav.missingIds}
          accept={nav.accept}
          reject={nav.reject}
        />
      }
    />
  );
}

function IssueNavigateShared({
  id,
  onClick,
  supplement,
}: {
  id: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  supplement: IssueSupplement;
}) {
  const nav = useBoundNavigate(supplement);
  return (
    <NavigateButton id={id} onClick={onClick} go={nav.go} resolution={null} />
  );
}

export function IssueNavigateButton({
  id,
  onClick,
  supplement,
}: {
  id: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  supplement?: IssueSupplement;
}) {
  if (supplement) {
    return (
      <IssueNavigateShared id={id} onClick={onClick} supplement={supplement} />
    );
  }
  return <IssueNavigateOwned id={id} onClick={onClick} />;
}

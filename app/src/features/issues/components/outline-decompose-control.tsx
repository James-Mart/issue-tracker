import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useDecomposeOutline } from "../api/mutations";
import { writeIssueDetailTabParam } from "../lib/issue-detail-tabs";
import type { OutlineExecutionGate } from "../lib/outline-planning-launch";
import { OutlineDecomposeDialog } from "./outline-decompose-dialog";

/** Decompose button and dialog for one outline. Confirm opens Planning. */
export function OutlineDecomposeControl({
  outlineId,
  version,
}: {
  outlineId: string;
  version: number;
}) {
  const [, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const decompose = useDecomposeOutline(outlineId);

  const confirm = (executionGate: OutlineExecutionGate) => {
    decompose.mutate(
      { executionGate },
      {
        onSuccess: () => {
          setOpen(false);
          setSearchParams(
            (prev) => writeIssueDetailTabParam(prev, "planning"),
            { replace: true },
          );
        },
      },
    );
  };

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="sm"
        data-testid="outline-decompose"
        onClick={() => setOpen(true)}
      >
        Decompose
      </Button>
      <OutlineDecomposeDialog
        open={open}
        version={version}
        confirming={decompose.isPending}
        onOpenChange={setOpen}
        onConfirm={confirm}
      />
    </>
  );
}

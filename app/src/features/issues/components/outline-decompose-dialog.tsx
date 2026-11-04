import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OutlineExecutionGate } from "../lib/outline-planning-launch";
import { GateToggleButton } from "./gate-toggle-button";

/** Confirm-then-act dialog before starting a decomposer on the latest version. */
export function OutlineDecomposeDialog({
  open,
  version,
  confirming,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  version: number;
  confirming?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (executionGate: OutlineExecutionGate) => void;
}) {
  const gateRef = useRef<HTMLButtonElement>(null);
  const [executionGate, setExecutionGate] =
    useState<OutlineExecutionGate>("off");

  useEffect(() => {
    if (open) setExecutionGate("off");
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (confirming && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        data-testid="outline-decompose-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          gateRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Decompose outline</DialogTitle>
          <DialogDescription>
            Create linked root work from version{" "}
            <span className="font-mono tabular-nums text-foreground">
              {version}
            </span>
            .
          </DialogDescription>
        </DialogHeader>
        <GateToggleButton
          ref={gateRef}
          id="outline-decompose-execution-gate"
          label="Execution gate"
          enabled={executionGate === "on"}
          disabled={confirming}
          testId="outline-decompose-execution-gate"
          onToggle={() =>
            setExecutionGate((current) => (current === "on" ? "off" : "on"))
          }
        />
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="current"
            disabled={confirming}
            data-testid="outline-decompose-confirm"
            onClick={() => onConfirm(executionGate)}
          >
            Decompose
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

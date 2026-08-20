import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { request } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { healthKeys } from "../api/keys";
import { useRestartProcess } from "../api/mutations";
import { useHealthQuery, type HealthResponse } from "../api/queries";
import {
  parseRunsInFlightRefusal,
  restartLiveTurnsMessage,
} from "../lib/restart-refusal";

export const RESTART_POLL_MS = 500;
export const RESTART_WAIT_MS = 30_000;

export const RESTART_UNSUPPORTED_REASON =
  "This process was not started by the supervisor and cannot restart itself.";

export const RESTART_PENDING_MESSAGE = "Waiting for the replacement process.";

export const RESTART_FAILURE_MESSAGE =
  "The replacement did not come back. The process needs attention where it was launched.";

export const RESTART_IDLE_LABEL = "Restart the API process";

type Phase = "idle" | "pending" | "failed";

export function RestartControl() {
  const qc = useQueryClient();
  const restart = useRestartProcess();
  const [phase, setPhase] = useState<Phase>("idle");
  const [capturedBootId, setCapturedBootId] = useState<string | null>(null);
  const [liveTurnCount, setLiveTurnCount] = useState<number | null>(null);
  const pending = phase === "pending";
  const health = useHealthQuery();

  const supported = health.data?.restartSupported === true;
  const failed = phase === "failed";
  const disabled =
    !supported || pending || !health.data?.bootId || restart.isPending;

  const status = !health.data
    ? null
    : !supported
      ? RESTART_UNSUPPORTED_REASON
      : pending
        ? RESTART_PENDING_MESSAGE
        : failed
          ? RESTART_FAILURE_MESSAGE
          : null;

  const tooltip = status ?? RESTART_IDLE_LABEL;

  useEffect(() => {
    if (!pending || capturedBootId === null) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await request<HealthResponse>("/api/health");
        if (cancelled) return;
        qc.setQueryData(healthKeys.current(), next);
        if (next.bootId === capturedBootId) return;
        setPhase("idle");
        setCapturedBootId(null);
        void qc.invalidateQueries();
      } catch {
        // The API is down for part of the gap.
      }
    };
    const interval = window.setInterval(() => {
      void poll();
    }, RESTART_POLL_MS);
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setPhase("failed");
      setCapturedBootId(null);
    }, RESTART_WAIT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [pending, capturedBootId, qc]);

  function postRestart(force = false) {
    const bootId = health.data?.bootId;
    if (!bootId || !supported || pending || restart.isPending) return;
    restart.mutate(force ? { force: true } : undefined, {
      onSuccess: () => {
        setLiveTurnCount(null);
        setCapturedBootId(bootId);
        setPhase("pending");
      },
      onError: (err) => {
        setPhase("idle");
        setCapturedBootId(null);
        const refusal = parseRunsInFlightRefusal(err);
        if (refusal) {
          setLiveTurnCount(refusal.activeRuns.length);
        }
      },
    });
  }

  return (
    <div className="flex min-w-0 max-w-full flex-col items-end gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={disabled}
              aria-label={RESTART_IDLE_LABEL}
              aria-busy={pending}
              aria-describedby={status ? "restart-control-status" : undefined}
              data-testid="restart-control"
              onClick={() => postRestart()}
            >
              <RotateCw
                className={cn(
                  pending &&
                    "animate-spin [color:hsl(var(--current))]",
                )}
              />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {status ? (
        <p
          id="restart-control-status"
          data-testid="restart-control-status"
          role={failed ? "alert" : "status"}
          aria-live={failed ? "assertive" : "polite"}
          className={cn(
            "max-w-[min(100%,20rem)] text-right font-mono text-[11px] leading-snug",
            pending && "text-[hsl(var(--current))]",
            failed && "text-[hsl(var(--warning))]",
            !supported && "text-muted-foreground",
          )}
        >
          {status}
        </p>
      ) : null}
      <Dialog
        open={liveTurnCount !== null}
        onOpenChange={(open) => {
          if (!open) setLiveTurnCount(null);
        }}
      >
        <DialogContent
          className="w-[calc(100%-2rem)] max-w-sm"
          data-testid="restart-live-turns-dialog"
        >
          <DialogHeader>
            <DialogTitle>Drop live turns?</DialogTitle>
            <DialogDescription>
              {liveTurnCount !== null
                ? restartLiveTurnsMessage(liveTurnCount)
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLiveTurnCount(null)}
              data-testid="restart-live-turns-dismiss"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => postRestart(true)}
              disabled={restart.isPending}
              data-testid="restart-live-turns-confirm"
            >
              Restart anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

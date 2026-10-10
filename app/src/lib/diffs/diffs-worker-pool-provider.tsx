import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import diffsWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url";

const diffsWorkerPoolOptions = {
  workerFactory: () => new Worker(diffsWorkerUrl, { type: "module" }),
};

export function DiffsWorkerPoolProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={diffsWorkerPoolOptions}
      highlighterOptions={{}}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}

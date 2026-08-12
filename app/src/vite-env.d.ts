/// <reference types="vite/client" />

/** Build-time transport version from vite `define` (config-load timestamp). */
declare const __TRANSPORT_VERSION__: number;

interface Window {
  /** Errors recorded before the bootstrap-fault module evaluates. */
  __bootstrapFaultQueue?: unknown[];
  /** Painted by the independent bootstrap-fault entry; main.tsx must not import that module. */
  __showBootstrapFault?: (error: unknown) => void;
}

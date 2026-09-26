import { readSecretsForRuntime } from "./secret-store.js";

const AGENT_STACK_ENV_KEY = /^AGENT_STACK_/;

/** Replacement written wherever a phase echoes a secret value. */
export const PHASE_SECRET_MASK = "***";

/**
 * Project secrets for phase env. A key that is itself an `AGENT_STACK_*`
 * variable is refused; the error names that key.
 */
export function loadPhaseSecrets(projectId: string): Record<string, string> {
  const secrets = readSecretsForRuntime(projectId);
  for (const key of Object.keys(secrets).sort()) {
    if (AGENT_STACK_ENV_KEY.test(key)) {
      throw new Error(
        `secret key "${key}" collides with an AGENT_STACK_* variable`,
      );
    }
  }
  return secrets;
}

function secretValues(secrets: Record<string, string>): string[] {
  return [...new Set(Object.values(secrets).filter((value) => value.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
}

/** Replace every secret value in `text`. Longer values are replaced first. */
export function maskSecrets(text: string, secrets: Record<string, string>): string {
  let masked = text;
  for (const value of secretValues(secrets)) {
    if (masked.includes(value)) masked = masked.split(value).join(PHASE_SECRET_MASK);
  }
  return masked;
}

/**
 * Streaming mask so a secret split across chunks is still replaced, while
 * complete output is emitted as soon as it cannot still grow into a secret.
 */
export function createPhaseOutputMasker(secrets: Record<string, string>): {
  push(chunk: string | Buffer): string;
  flush(): string;
} {
  const values = secretValues(secrets);
  const decoder = new TextDecoder();
  let pending = "";

  function isProperPrefix(text: string): boolean {
    return values.some((value) => value.startsWith(text) && text.length < value.length);
  }

  function drain(flushing: boolean): string {
    let emitted = "";
    for (;;) {
      // Stream close: a held prefix never completed into a secret. Mask it
      // instead of writing the recoverable prefix.
      if (flushing && pending.length > 0 && isProperPrefix(pending)) {
        emitted += PHASE_SECRET_MASK;
        pending = "";
        break;
      }
      const match = values.find((value) => pending.startsWith(value));
      if (match !== undefined) {
        const longerMightContinue = !flushing && isProperPrefix(pending);
        if (longerMightContinue) break;
        emitted += PHASE_SECRET_MASK;
        pending = pending.slice(match.length);
        continue;
      }
      if (pending.length === 0) break;
      if (!flushing && isProperPrefix(pending)) break;
      const char = String.fromCodePoint(pending.codePointAt(0)!);
      emitted += char;
      pending = pending.slice(char.length);
    }
    return emitted;
  }

  return {
    push(chunk: string | Buffer): string {
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      if (values.length === 0) return text;
      pending += text;
      return drain(false);
    },
    flush(): string {
      const tail = decoder.decode();
      if (values.length === 0) return tail;
      pending += tail;
      return drain(true);
    },
  };
}

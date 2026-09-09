import { useEffect, useState } from "react";

export type VoiceSessionOwner = "composer" | "description";

let holder: VoiceSessionOwner | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function tryAcquire(owner: VoiceSessionOwner): boolean {
  if (holder === null || holder === owner) {
    if (holder !== owner) {
      holder = owner;
      notifyListeners();
    }
    return true;
  }
  return false;
}

export function release(owner: VoiceSessionOwner): void {
  if (holder !== owner) return;
  holder = null;
  notifyListeners();
}

export function activeOwner(): VoiceSessionOwner | null {
  return holder;
}

export function subscribeVoiceSessionLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVoiceSessionActiveOwner(): VoiceSessionOwner | null {
  const [owner, setOwner] = useState(activeOwner);
  useEffect(() => subscribeVoiceSessionLock(() => setOwner(activeOwner())), []);
  return owner;
}

export function resetVoiceSessionLockForTests(): void {
  holder = null;
  notifyListeners();
}

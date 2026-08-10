type Listener = (event: Event) => void;

/**
 * Test double for the browser `EventSource` used by conversation SSE.
 * Install via `vi.stubGlobal("EventSource", FakeEventSource)`.
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private readonly listeners = new Map<string, Set<Listener>>();
  private closed = false;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener as Listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  emitOpen(): void {
    this.readyState = 1;
    this.emit("open");
  }

  emitPing(): void {
    this.emit("ping");
  }

  emitMessage(data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    this.onmessage?.(event);
  }

  emitError(): void {
    this.onerror?.(new Event("error"));
  }

  private emit(type: string): void {
    const event = new Event(type);
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }
}

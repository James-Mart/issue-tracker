type FakeListener = (event: Event) => void;

/**
 * Test double for the browser `WebSocket` used by the transport client.
 * Install via `vi.stubGlobal("WebSocket", FakeWebSocket)`.
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Set<FakeListener>>();
  private closed = false;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as FakeListener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener as FakeListener);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(JSON.parse(String(data)));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.emitClose();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    const event = new Event("open");
    this.onopen?.(event);
    this.emit("open", event);
  }

  emitMessage(data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    this.onmessage?.(event);
    this.emit("message", event);
  }

  emitError(): void {
    const event = new Event("error");
    this.onerror?.(event);
    this.emit("error", event);
  }

  emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.closed = true;
    const event = new CloseEvent("close");
    this.onclose?.(event);
    this.emit("close", event);
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }
}

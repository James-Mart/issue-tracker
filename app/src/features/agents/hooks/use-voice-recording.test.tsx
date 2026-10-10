// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useVoiceRecording,
  VOICE_RECORDING_SAMPLE_RATE,
} from "./use-voice-recording";

type HookView = ReturnType<typeof useVoiceRecording>;

class FakeMediaStreamTrack {
  stop = vi.fn();
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeMediaStreamTrack[]) {}

  getTracks() {
    return this.tracks;
  }
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];

  state: RecordingState = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  private listeners = new Map<string, Set<EventListener>>();

  constructor(public stream: MediaStream) {
    FakeMediaRecorder.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    if (type === "dataavailable") {
      this.ondataavailable = listener as (event: BlobEvent) => void;
    }
    if (type === "stop") {
      this.onstop = listener as () => void;
    }
    void options;
  }

  start() {
    this.state = "recording";
    queueMicrotask(() => {
      this.emit("dataavailable", { data: new Blob(["webm-chunk"]) });
    });
  }

  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.emit("stop");
      this.onstop?.();
    });
  }

  private emit(type: string, detail?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      if (type === "dataavailable") {
        (listener as (event: BlobEvent) => void)(detail as BlobEvent);
      } else {
        (listener as EventListener)(new Event(type));
      }
    }
  }
}

function mountHook(): {
  root: Root;
  container: HTMLDivElement;
  getView: () => HookView;
  transcribe: ReturnType<typeof vi.fn<(samples: Float32Array) => Promise<string>>>;
  onTranscript: ReturnType<typeof vi.fn<(text: string) => void>>;
} {
  const transcribe = vi.fn(async (_samples: Float32Array) => "hello world");
  const onTranscript = vi.fn((_text: string) => {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let view!: HookView;

  function Probe() {
    useRef<HookView | null>(null);
    view = useVoiceRecording({ transcribe, onTranscript });
    return null;
  }

  act(() => {
    root.render(<Probe />);
  });

  return {
    root,
    container,
    getView: () => view,
    transcribe,
    onTranscript,
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useVoiceRecording", () => {
  let track: FakeMediaStreamTrack;
  let stream: FakeMediaStream;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let decodeAudioData: ReturnType<typeof vi.fn>;
  let offlineStartRendering: ReturnType<typeof vi.fn>;
  let decodeContextClose: ReturnType<typeof vi.fn>;
  let offlineInstances: Array<{
    channels: number;
    length: number;
    sampleRate: number;
  }>;

  beforeEach(() => {
    offlineInstances = [];
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    track = new FakeMediaStreamTrack();
    stream = new FakeMediaStream([track]);
    getUserMedia = vi.fn(async () => stream as unknown as MediaStream);

    decodeContextClose = vi.fn(async () => {});
    decodeAudioData = vi.fn(async () => {
      return {
        sampleRate: 48_000,
        length: 48_000,
        numberOfChannels: 2,
        duration: 1,
        getChannelData: (channel: number) =>
          channel === 0
            ? new Float32Array([0.1, 0.2, 0.3])
            : new Float32Array([0.4, 0.5, 0.6]),
      } as AudioBuffer;
    });

    offlineStartRendering = vi.fn(async () => ({
      getChannelData: () => new Float32Array([0.11, 0.22, 0.33, 0.44]),
    }));

    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    });
    vi.stubGlobal(
      "MediaRecorder",
      FakeMediaRecorder as unknown as typeof MediaRecorder,
    );
    vi.stubGlobal("AudioContext", class {
      decodeAudioData = decodeAudioData;
      close = decodeContextClose;
    });
    vi.stubGlobal("OfflineAudioContext", class {
      constructor(
        public channels: number,
        public length: number,
        public sampleRate: number,
      ) {
        offlineInstances.push({ channels, length, sampleRate });
      }

      createBuffer(channels: number, length: number, sampleRate: number) {
        const channelData = new Float32Array(length);
        return {
          copyToChannel(source: Float32Array) {
            channelData.set(source);
          },
          getChannelData: () => channelData,
          sampleRate,
          length,
          numberOfChannels: channels,
        };
      }

      createBufferSource() {
        return {
          buffer: null as AudioBuffer | null,
          connect: vi.fn(),
          start: vi.fn(),
        };
      }

      get destination() {
        return {};
      }

      startRendering = offlineStartRendering;
    });

    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("passes converted 16 kHz mono samples to transcribe and onTranscript on confirm", async () => {
    const harness = mountHook();

    act(() => {
      harness.getView().start();
    });
    await flushPromises();

    expect(harness.getView().state).toBe("recording");
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    act(() => {
      harness.getView().confirm();
    });
    await flushPromises();

    expect(track.stop).toHaveBeenCalled();
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(offlineStartRendering).toHaveBeenCalledTimes(1);
    const offline = offlineInstances.at(-1);
    expect(offline?.sampleRate).toBe(VOICE_RECORDING_SAMPLE_RATE);
    expect(offline?.channels).toBe(1);
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    const samples = harness.transcribe.mock.calls[0]?.[0];
    expect(samples).toBeInstanceOf(Float32Array);
    expect(samples?.length).toBe(4);
    expect(harness.onTranscript).toHaveBeenCalledWith("hello world");
    expect(harness.getView().state).toBe("idle");
  });

  it("stops a stream that resolves after cancel and does not start capture", async () => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockImplementationOnce(() => pending.promise);
    const harness = mountHook();

    act(() => {
      harness.getView().start();
    });
    expect(harness.getView().state).toBe("idle");

    act(() => {
      harness.getView().cancel();
    });
    act(() => {
      pending.resolve(stream as unknown as MediaStream);
    });
    await flushPromises();

    expect(track.stop).toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(harness.getView().state).toBe("idle");
    expect(harness.getView().elapsedSeconds).toBe(0);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(harness.getView().elapsedSeconds).toBe(0);
    expect(harness.getView().state).toBe("idle");
  });

  it("releases the microphone track on unmount", async () => {
    const harness = mountHook();

    act(() => {
      harness.getView().start();
    });
    await flushPromises();

    expect(harness.getView().state).toBe("recording");
    track.stop.mockClear();

    act(() => {
      harness.root.unmount();
    });
    await flushPromises();

    expect(track.stop).toHaveBeenCalled();
  });
});

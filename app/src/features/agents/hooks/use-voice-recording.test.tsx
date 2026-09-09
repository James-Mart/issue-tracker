// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  convertRecordingBlobTo16kHzMono,
  useVoiceRecording,
  VOICE_RECORDING_CAP_SECONDS,
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

function mountHook(
  options: {
    transcribe?: (samples: Float32Array) => Promise<string>;
    onTranscript?: (text: string) => void;
  } = {},
): {
  root: Root;
  container: HTMLDivElement;
  getView: () => HookView;
  transcribe: ReturnType<typeof vi.fn<(samples: Float32Array) => Promise<string>>>;
  onTranscript: ReturnType<typeof vi.fn<(text: string) => void>>;
} {
  const transcribe = vi.fn(
    options.transcribe ??
      (async () => {
        return "hello world";
      }),
  );
  const onTranscript = vi.fn(options.onTranscript ?? (() => {}));
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

  it("lands in review at the cap with the track released and elapsed frozen", async () => {
    const harness = mountHook();

    act(() => {
      harness.getView().start();
    });
    await flushPromises();

    act(() => {
      vi.advanceTimersByTime(VOICE_RECORDING_CAP_SECONDS * 1000);
    });
    await flushPromises();

    expect(harness.getView().state).toBe("review");
    expect(harness.getView().elapsedSeconds).toBe(VOICE_RECORDING_CAP_SECONDS);
    expect(track.stop).toHaveBeenCalled();

    act(() => {
      harness.getView().confirm();
    });
    await flushPromises();

    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    expect(harness.onTranscript).toHaveBeenCalledWith("hello world");
    expect(harness.getView().state).toBe("idle");
  });

  it("handles denied permission and retry re-requests microphone access", async () => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException("denied", "NotAllowedError"),
    );
    const harness = mountHook();

    act(() => {
      harness.getView().start();
    });
    await flushPromises();

    expect(harness.getView().state).toBe("error");
    expect(harness.getView().errorKind).toBe("permission");
    expect(harness.getView().errorReason).toContain("denied");
    expect(harness.transcribe).not.toHaveBeenCalled();

    act(() => {
      harness.getView().retry();
    });
    await flushPromises();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(harness.getView().state).toBe("recording");
    expect(harness.transcribe).not.toHaveBeenCalled();
  });

  it("ignores duplicate start calls while microphone access is in flight", async () => {
    let resolveGetUserMedia: (stream: MediaStream) => void = () => {};
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveGetUserMedia = resolve;
        }),
    );
    const harness = mountHook();

    act(() => {
      harness.getView().start();
      harness.getView().start();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);

    act(() => {
      resolveGetUserMedia(stream as unknown as MediaStream);
    });
    await flushPromises();

    expect(harness.getView().state).toBe("recording");
  });

  it("ignores duplicate confirm calls while conversion is in flight", async () => {
    let resolveDecode: (buffer: AudioBuffer) => void = () => {};
    decodeAudioData.mockImplementationOnce(
      () =>
        new Promise<AudioBuffer>((resolve) => {
          resolveDecode = resolve;
        }),
    );
    const harness = mountHook();

    act(() => {
      harness.getView().start();
    });
    await flushPromises();
    act(() => {
      harness.getView().confirm();
      harness.getView().confirm();
    });
    await flushPromises();

    act(() => {
      resolveDecode({
        sampleRate: 48_000,
        length: 3,
        numberOfChannels: 1,
        duration: 1,
        getChannelData: () => new Float32Array([0.1, 0.2, 0.3]),
      } as AudioBuffer);
    });
    await flushPromises();
    await flushPromises();

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
  });

  it("retries conversion failures from the held blob without re-recording", async () => {
    decodeAudioData
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockResolvedValueOnce({
        sampleRate: 48_000,
        length: 3,
        numberOfChannels: 1,
        duration: 1,
        getChannelData: () => new Float32Array([0.1, 0.2, 0.3]),
      } as AudioBuffer);
    const harness = mountHook();

    act(() => {
      harness.getView().start();
    });
    await flushPromises();
    act(() => {
      harness.getView().confirm();
    });
    await flushPromises();

    expect(harness.getView().state).toBe("error");
    expect(harness.getView().errorKind).toBe("transcription");
    expect(harness.transcribe).not.toHaveBeenCalled();

    act(() => {
      harness.getView().retry();
    });
    await flushPromises();

    expect(decodeAudioData).toHaveBeenCalledTimes(2);
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    expect(harness.onTranscript).toHaveBeenCalledWith("hello world");
    expect(harness.getView().state).toBe("idle");
  });

  it("retries failed transcription with the same samples without re-converting", async () => {
    const transcribe = vi
      .fn<(samples: Float32Array) => Promise<string>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce("second try");
    const harness = mountHook({ transcribe });

    act(() => {
      harness.getView().start();
    });
    await flushPromises();
    act(() => {
      harness.getView().confirm();
    });
    await flushPromises();

    expect(harness.getView().state).toBe("error");
    expect(harness.getView().errorKind).toBe("transcription");
    expect(decodeAudioData).toHaveBeenCalledTimes(1);

    act(() => {
      harness.getView().retry();
    });
    await flushPromises();

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(harness.transcribe).toHaveBeenCalledTimes(2);
    expect(harness.transcribe.mock.calls[0]?.[0]).toBe(
      harness.transcribe.mock.calls[1]?.[0],
    );
    expect(harness.onTranscript).toHaveBeenCalledWith("second try");
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

  it.each([
    ["recording", "recording"] as const,
    ["review", "review"] as const,
    ["error", "error"] as const,
  ])(
    "cancel from %s returns to idle and releases the track",
    async (from, setupState) => {
      const harness = mountHook();

      if (setupState === "recording") {
        act(() => {
          harness.getView().start();
        });
        await flushPromises();
      }

      if (setupState === "review") {
        act(() => {
          harness.getView().start();
        });
        await flushPromises();
        act(() => {
          vi.advanceTimersByTime(VOICE_RECORDING_CAP_SECONDS * 1000);
        });
        await flushPromises();
      }

      if (setupState === "error") {
        getUserMedia.mockRejectedValueOnce(
          new DOMException("denied", "NotAllowedError"),
        );
        act(() => {
          harness.getView().start();
        });
        await flushPromises();
      }

      expect(harness.getView().state).toBe(from);
      track.stop.mockClear();

      act(() => {
        harness.getView().cancel();
      });
      await flushPromises();

      expect(harness.getView().state).toBe("idle");
      if (from === "recording") {
        expect(track.stop).toHaveBeenCalled();
      }
    },
  );
});

describe("convertRecordingBlobTo16kHzMono", () => {
  it("mixes stereo input down to mono before resampling", async () => {
    const offlineInstances: Array<{ sampleRate: number }> = [];
    const decodeAudioData = vi.fn(async () => ({
      sampleRate: 48_000,
      length: 3,
      numberOfChannels: 2,
      duration: 3 / 48_000,
      getChannelData: (channel: number) =>
        channel === 0
          ? new Float32Array([1, 0, 0])
          : new Float32Array([0, 1, 0]),
    }));
    const offlineStartRendering = vi.fn(async () => ({
      getChannelData: () => new Float32Array([0.5, 0.5, 0.5]),
    }));

    vi.stubGlobal("AudioContext", class {
      decodeAudioData = decodeAudioData;
      close = vi.fn(async () => {});
    });
    vi.stubGlobal("OfflineAudioContext", class {
      constructor(
        public channels: number,
        public length: number,
        public sampleRate: number,
      ) {
        offlineInstances.push({ sampleRate });
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

    const samples = await convertRecordingBlobTo16kHzMono(new Blob(["audio"]));
    expect(samples).toEqual(new Float32Array([0.5, 0.5, 0.5]));
    expect(offlineInstances.at(-1)?.sampleRate).toBe(
      VOICE_RECORDING_SAMPLE_RATE,
    );
  });
});

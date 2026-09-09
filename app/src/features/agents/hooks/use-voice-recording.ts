import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecordingState =
  | "idle"
  | "recording"
  | "review"
  | "transcribing"
  | "error";

export type VoiceRecordingErrorKind = "permission" | "transcription";

export const VOICE_RECORDING_CAP_SECONDS = 600;
export const VOICE_RECORDING_SAMPLE_RATE = 16_000;

type UseVoiceRecordingOptions = {
  transcribe: (samples: Float32Array) => Promise<string>;
  onTranscript: (text: string) => void;
};

type UseVoiceRecordingResult = {
  state: VoiceRecordingState;
  elapsedSeconds: number;
  errorKind: VoiceRecordingErrorKind | null;
  errorReason: string | null;
  start: () => void;
  cancel: () => void;
  confirm: () => void;
  retry: () => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const { length, numberOfChannels } = audioBuffer;
  const mono = new Float32Array(length);
  if (numberOfChannels === 1) {
    mono.set(audioBuffer.getChannelData(0));
    return mono;
  }
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      sum += audioBuffer.getChannelData(channel)[i] ?? 0;
    }
    mono[i] = sum / numberOfChannels;
  }
  return mono;
}

/** Decode a recorded blob and resample to 16 kHz mono float32 for transcription. */
export async function convertRecordingBlobTo16kHzMono(
  blob: Blob,
): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeContext = new AudioContext();
  try {
    const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
    const sourceRate = decoded.sampleRate;
    const monoSamples = mixToMono(decoded);
    const targetLength = Math.ceil(
      monoSamples.length * (VOICE_RECORDING_SAMPLE_RATE / sourceRate),
    );
    const offline = new OfflineAudioContext(
      1,
      targetLength,
      VOICE_RECORDING_SAMPLE_RATE,
    );
    const buffer = offline.createBuffer(1, monoSamples.length, sourceRate);
    buffer.copyToChannel(monoSamples, 0);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    void decodeContext.close();
  }
}

export function useVoiceRecording({
  transcribe,
  onTranscript,
}: UseVoiceRecordingOptions): UseVoiceRecordingResult {
  const transcribeRef = useRef(transcribe);
  const onTranscriptRef = useRef(onTranscript);
  transcribeRef.current = transcribe;
  onTranscriptRef.current = onTranscript;

  const [state, setState] = useState<VoiceRecordingState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorKind, setErrorKind] = useState<VoiceRecordingErrorKind | null>(
    null,
  );
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);
  const convertedSamplesRef = useRef<Float32Array | null>(null);
  const elapsedIntervalRef = useRef<number | null>(null);
  const stopCapturePromiseRef = useRef<Promise<Blob> | null>(null);

  const clearElapsedInterval = useCallback(() => {
    if (elapsedIntervalRef.current !== null) {
      window.clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
  }, []);

  const releaseMicrophoneTrack = useCallback(() => {
    for (const track of mediaStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    mediaStreamRef.current = null;
  }, []);

  const resetRecordingSession = useCallback(() => {
    clearElapsedInterval();
    releaseMicrophoneTrack();
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    recordedBlobRef.current = null;
    convertedSamplesRef.current = null;
    stopCapturePromiseRef.current = null;
    setElapsedSeconds(0);
    setErrorKind(null);
    setErrorReason(null);
  }, [clearElapsedInterval, releaseMicrophoneTrack]);

  const stopCapture = useCallback((): Promise<Blob> => {
    if (stopCapturePromiseRef.current) {
      return stopCapturePromiseRef.current;
    }

    stopCapturePromiseRef.current = new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        releaseMicrophoneTrack();
        resolve(recordedBlobRef.current ?? new Blob());
        return;
      }

      recorder.addEventListener(
        "stop",
        () => {
          releaseMicrophoneTrack();
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          recordedBlobRef.current = blob;
          resolve(blob);
        },
        { once: true },
      );
      recorder.stop();
    });

    return stopCapturePromiseRef.current;
  }, [releaseMicrophoneTrack]);

  const startElapsedTimer = useCallback(() => {
    clearElapsedInterval();
    elapsedIntervalRef.current = window.setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next >= VOICE_RECORDING_CAP_SECONDS) {
          clearElapsedInterval();
          void (async () => {
            await stopCapture();
            setState("review");
          })();
          return VOICE_RECORDING_CAP_SECONDS;
        }
        return next;
      });
    }, 1000);
  }, [clearElapsedInterval, stopCapture]);

  const beginCapture = useCallback(async () => {
    resetRecordingSession();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.start();
      setState("recording");
      startElapsedTimer();
    } catch (error) {
      resetRecordingSession();
      setErrorKind("permission");
      setErrorReason(errorMessage(error));
      setState("error");
    }
  }, [resetRecordingSession, startElapsedTimer]);

  const start = useCallback(() => {
    if (state !== "idle") return;
    void beginCapture();
  }, [beginCapture, state]);

  const cancel = useCallback(() => {
    if (
      state !== "recording" &&
      state !== "review" &&
      state !== "error"
    ) {
      return;
    }
    clearElapsedInterval();
    void stopCapture();
    resetRecordingSession();
    setState("idle");
  }, [clearElapsedInterval, resetRecordingSession, state, stopCapture]);

  const runTranscription = useCallback(async (samples: Float32Array) => {
    convertedSamplesRef.current = samples;
    setState("transcribing");
    setErrorKind(null);
    setErrorReason(null);
    try {
      const text = await transcribeRef.current(samples);
      onTranscriptRef.current(text);
      resetRecordingSession();
      setState("idle");
    } catch (error) {
      setErrorKind("transcription");
      setErrorReason(errorMessage(error));
      setState("error");
    }
  }, [resetRecordingSession]);

  const confirm = useCallback(() => {
    if (state !== "recording" && state !== "review") return;
    clearElapsedInterval();
    void (async () => {
      const blob =
        state === "review"
          ? (recordedBlobRef.current ?? (await stopCapture()))
          : await stopCapture();
      if (blob.size === 0) {
        setErrorKind("transcription");
        setErrorReason("No audio was captured");
        setState("error");
        return;
      }
      try {
        const samples = await convertRecordingBlobTo16kHzMono(blob);
        await runTranscription(samples);
      } catch (error) {
        setErrorKind("transcription");
        setErrorReason(errorMessage(error));
        setState("error");
      }
    })();
  }, [clearElapsedInterval, runTranscription, state, stopCapture]);

  const retry = useCallback(() => {
    if (state !== "error") return;
    if (errorKind === "permission") {
      void beginCapture();
      return;
    }
    if (errorKind === "transcription") {
      const samples = convertedSamplesRef.current;
      if (!samples) return;
      void runTranscription(samples);
    }
  }, [beginCapture, errorKind, runTranscription, state]);

  useEffect(() => {
    return () => {
      clearElapsedInterval();
    };
  }, [clearElapsedInterval]);

  return {
    state,
    elapsedSeconds,
    errorKind,
    errorReason,
    start,
    cancel,
    confirm,
    retry,
  };
}

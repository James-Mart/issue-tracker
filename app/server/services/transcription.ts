import { join } from "path";
import sherpaOnnx from "sherpa-onnx-node";
import {
  asrModelFilesPresent,
  ensureAsrModel,
  isAsrModelProvisionInFlight,
  resolveAsrModelDirIfPresent,
} from "../../scripts/ensure-asr-model.js";

const { OfflineRecognizer } = sherpaOnnx;

type OfflineRecognizerInstance = InstanceType<typeof OfflineRecognizer>;

let recognizer: OfflineRecognizerInstance | null = null;
let recognizerInit: Promise<OfflineRecognizerInstance> | null = null;

function buildRecognizerConfig(modelDir: string) {
  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(modelDir, "encoder.int8.onnx"),
        decoder: join(modelDir, "decoder.int8.onnx"),
        joiner: join(modelDir, "joiner.int8.onnx"),
      },
      tokens: join(modelDir, "tokens.txt"),
      modelType: "nemo_transducer",
      provider: "cpu",
      numThreads: 4,
    },
    decodingMethod: "greedy_search",
  };
}

async function initRecognizer(): Promise<OfflineRecognizerInstance> {
  const modelDir = await ensureAsrModel();
  if (!asrModelFilesPresent(modelDir)) {
    throw new Error(`ASR model files are missing under ${modelDir}`);
  }

  const config = buildRecognizerConfig(modelDir);
  try {
    const instance = await OfflineRecognizer.createAsync(config);
    recognizer = instance;
    return instance;
  } catch (err) {
    recognizerInit = null;
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to construct ASR OfflineRecognizer: ${detail}`, {
      cause: err,
    });
  }
}

async function getRecognizer(): Promise<OfflineRecognizerInstance> {
  if (recognizer) return recognizer;
  if (!recognizerInit) {
    recognizerInit = initRecognizer();
  }
  return recognizerInit;
}

const UNAVAILABLE_REASON = "ASR model is not provisioned";
const DOWNLOADING_REASON = "Downloading speech model…";

function startAsrModelProvision(): void {
  void ensureAsrModel().catch((err) => {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`ASR model provision failed: ${detail}`);
  });
}

/** Whether local ASR weights are present. Starts a download when they are not. */
export async function isTranscriptionAvailable(): Promise<boolean> {
  if (resolveAsrModelDirIfPresent()) return true;
  startAsrModelProvision();
  return resolveAsrModelDirIfPresent() !== null;
}

/** Capability payload for the composer mic — kicks off provision when missing. */
export async function transcriptionCapability(): Promise<{
  available: boolean;
  reason?: string;
}> {
  const available = await isTranscriptionAvailable();
  if (available) return { available: true };
  return {
    available: false,
    reason: isAsrModelProvisionInFlight()
      ? DOWNLOADING_REASON
      : UNAVAILABLE_REASON,
  };
}

/** Transcribe mono float32 samples in [-1, 1] at the given sample rate. */
export async function transcribe(
  samples: Float32Array,
  sampleRate: number,
): Promise<string> {
  const rec = await getRecognizer();
  const stream = rec.createStream();
  stream.acceptWaveform({ samples, sampleRate });
  rec.decode(stream);
  const result = rec.getResult(stream);
  const text = result.text.trim();
  if (!text) {
    throw new Error("Transcription produced empty text");
  }
  return text;
}

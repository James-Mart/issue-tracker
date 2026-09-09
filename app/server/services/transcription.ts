import { join } from "path";
import sherpaOnnx from "sherpa-onnx-node";
import {
  asrModelFilesPresent,
  ensureAsrModel,
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

/** Whether local ASR weights are present without triggering a download. */
export async function isTranscriptionAvailable(): Promise<boolean> {
  return resolveAsrModelDirIfPresent() !== null;
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

import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateAsync = vi.hoisted(() => vi.fn());
const mockEnsureAsrModel = vi.hoisted(() => vi.fn());
const mockResolveAsrModelDirIfPresent = vi.hoisted(() => vi.fn());
const mockIsAsrModelProvisionInFlight = vi.hoisted(() => vi.fn());

const mockStream = vi.hoisted(() => ({
  acceptWaveform: vi.fn(),
}));

const mockRecognizer = vi.hoisted(() => ({
  createStream: vi.fn(() => mockStream),
  decode: vi.fn(),
  getResult: vi.fn(() => ({ text: "hello world" })),
}));

vi.mock("sherpa-onnx-node", () => ({
  default: {
    OfflineRecognizer: class OfflineRecognizer {
      static createAsync = mockCreateAsync;
    },
  },
}));

vi.mock("../../scripts/ensure-asr-model.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../scripts/ensure-asr-model.js")>();
  return {
    ...actual,
    ensureAsrModel: mockEnsureAsrModel,
    resolveAsrModelDirIfPresent: mockResolveAsrModelDirIfPresent,
    isAsrModelProvisionInFlight: mockIsAsrModelProvisionInFlight,
  };
});

let modelDir: string;

beforeEach(async () => {
  vi.resetModules();
  modelDir = mkdtempSync(join(tmpdir(), "issue-tracker-asr-"));
  for (const name of [
    "encoder.int8.onnx",
    "decoder.int8.onnx",
    "joiner.int8.onnx",
    "tokens.txt",
  ]) {
    writeFileSync(join(modelDir, name), "");
  }
  mockCreateAsync.mockReset();
  mockCreateAsync.mockResolvedValue(mockRecognizer);
  mockEnsureAsrModel.mockReset();
  mockEnsureAsrModel.mockResolvedValue(modelDir);
  mockResolveAsrModelDirIfPresent.mockReset();
  mockIsAsrModelProvisionInFlight.mockReset();
  mockIsAsrModelProvisionInFlight.mockReturnValue(false);
  mockRecognizer.createStream.mockClear();
  mockRecognizer.decode.mockClear();
  mockRecognizer.getResult.mockReset();
  mockRecognizer.getResult.mockReturnValue({ text: "hello world" });
  mockStream.acceptWaveform.mockClear();
});

afterEach(() => {
  rmSync(modelDir, { recursive: true, force: true });
});

async function loadTranscription() {
  return import("./transcription.js");
}

describe("transcription", () => {
  it("reuses one OfflineRecognizer across repeated transcribe calls", async () => {
    const { transcribe } = await loadTranscription();
    const samples = new Float32Array([0.1, 0.2]);

    await transcribe(samples, 16000);
    await transcribe(samples, 16000);

    expect(mockCreateAsync).toHaveBeenCalledTimes(1);
    expect(mockRecognizer.createStream).toHaveBeenCalledTimes(2);
  });

  it("passes the verified Parakeet configuration to OfflineRecognizer.createAsync", async () => {
    const { transcribe } = await loadTranscription();
    await transcribe(new Float32Array([0.1]), 16000);

    expect(mockCreateAsync).toHaveBeenCalledWith({
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
    });
  });

  it("decodes samples through acceptWaveform and returns trimmed text", async () => {
    const { transcribe } = await loadTranscription();
    const samples = new Float32Array([0.1, -0.2]);
    mockRecognizer.getResult.mockReturnValue({ text: "  hello world  " });

    const text = await transcribe(samples, 16000);

    expect(mockStream.acceptWaveform).toHaveBeenCalledWith({
      samples,
      sampleRate: 16000,
    });
    expect(mockRecognizer.decode).toHaveBeenCalledWith(mockStream);
    expect(text).toBe("hello world");
  });

  it("throws when the model directory is missing required files", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "issue-tracker-asr-empty-"));
    mockEnsureAsrModel.mockResolvedValue(emptyDir);
    const { transcribe } = await loadTranscription();

    await expect(transcribe(new Float32Array([0.1]), 16000)).rejects.toThrow(
      /ASR model files are missing/,
    );

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("throws when OfflineRecognizer construction fails", async () => {
    mockCreateAsync.mockRejectedValue(new Error("native load failed"));
    const { transcribe } = await loadTranscription();

    await expect(transcribe(new Float32Array([0.1]), 16000)).rejects.toThrow(
      /Failed to construct ASR OfflineRecognizer/,
    );
  });

  it("throws when decode returns empty text", async () => {
    mockRecognizer.getResult.mockReturnValue({ text: "   " });
    const { transcribe } = await loadTranscription();

    await expect(transcribe(new Float32Array([0.1]), 16000)).rejects.toThrow(
      /empty text/,
    );
  });

  it("reports availability from resolveAsrModelDirIfPresent", async () => {
    mockResolveAsrModelDirIfPresent.mockReturnValueOnce(modelDir);
    const { isTranscriptionAvailable } = await loadTranscription();
    await expect(isTranscriptionAvailable()).resolves.toBe(true);
    expect(mockEnsureAsrModel).not.toHaveBeenCalled();

    vi.resetModules();
    mockResolveAsrModelDirIfPresent.mockReturnValue(null);
    const again = await loadTranscription();
    await expect(again.isTranscriptionAvailable()).resolves.toBe(false);
    expect(mockEnsureAsrModel).toHaveBeenCalled();
  });

  it("capability reports downloading while provision is in flight", async () => {
    mockResolveAsrModelDirIfPresent.mockReturnValue(null);
    mockIsAsrModelProvisionInFlight.mockReturnValue(true);
    const { transcriptionCapability } = await loadTranscription();
    await expect(transcriptionCapability()).resolves.toEqual({
      available: false,
      reason: "Downloading speech model…",
    });
  });
});

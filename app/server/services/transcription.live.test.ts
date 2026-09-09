import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ensureAsrModel } from "../../scripts/ensure-asr-model.js";
import { transcribe } from "./transcription.js";

// Live ASR suite: authored and preserved, but excluded from the default
// `npm test`. Enabled only via `npm run test:live`, which sets
// `CURSOR_SDK_LIVE` — the same gate as the SDK live suites.

const LIVE_TIMEOUT_MS = 120_000;

describe.skipIf(!process.env.CURSOR_SDK_LIVE)("transcription (live)", () => {
  it(
    "transcribes test_wavs/0.wav from the provisioned Parakeet model",
    async () => {
      const modelDir = await ensureAsrModel();
      const wavPath = join(modelDir, "test_wavs", "0.wav");
      expect(existsSync(wavPath)).toBe(true);

      const sherpaOnnx = await import("sherpa-onnx-node");
      const wave = sherpaOnnx.default.readWave(wavPath);

      const text = await transcribe(wave.samples, wave.sampleRate);

      expect(text.length).toBeGreaterThan(0);
      expect(text.toLowerCase()).toMatch(/phebe|portrait|observed/);
    },
    LIVE_TIMEOUT_MS,
  );
});

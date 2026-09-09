import { Router, type RequestHandler } from "express";
import { uploadTranscriptionAudio } from "../middleware/upload-transcription-audio.js";
import { cleanTranscript } from "../services/transcript-cleanup.js";
import {
  isTranscriptionAvailable,
  transcribe,
} from "../services/transcription.js";

const UNAVAILABLE_REASON = "ASR model is not provisioned";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export type TranscriptionRouteDeps = {
  isTranscriptionAvailable: () => Promise<boolean>;
  transcribe: (samples: Float32Array, sampleRate: number) => Promise<string>;
  cleanTranscript: (text: string) => Promise<string>;
};

function float32SamplesFromBuffer(buf: Buffer): Float32Array | { error: string } {
  if (buf.length === 0) {
    return { error: "audio is required" };
  }
  if (buf.length % 4 !== 0) {
    return { error: "audio must be float32 little-endian samples" };
  }
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

export function createTranscriptionsRouter(
  deps: TranscriptionRouteDeps = {
    isTranscriptionAvailable,
    transcribe,
    cleanTranscript,
  },
): Router {
  const router = Router();

  router.get(
    "/capability",
    asyncRoute(async (_req, res) => {
      const available = await deps.isTranscriptionAvailable();
      if (available) {
        res.json({ available: true });
        return;
      }
      res.json({ available: false, reason: UNAVAILABLE_REASON });
    }),
  );

  router.post(
    "/",
    uploadTranscriptionAudio,
    asyncRoute(async (req, res) => {
      const available = await deps.isTranscriptionAvailable();
      if (!available) {
        res.status(503).json({ error: UNAVAILABLE_REASON });
        return;
      }

      const file = req.file;
      if (!file?.buffer) {
        res.status(400).json({ error: "audio is required" });
        return;
      }

      const parsed = float32SamplesFromBuffer(file.buffer);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      let raw: string;
      try {
        raw = await deps.transcribe(parsed, 16_000);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(502).json({ error: message });
        return;
      }

      const text = await deps.cleanTranscript(raw);
      res.json({ text });
    }),
  );

  return router;
}

export const transcriptionsRouter = createTranscriptionsRouter();

import type { RequestHandler } from "express";
import multer, { MulterError } from "multer";

/** Ten minutes of 16 kHz mono float32 samples (bytes). */
export const MAX_TRANSCRIPTION_AUDIO_BYTES = 16_000 * 60 * 10 * 4;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TRANSCRIPTION_AUDIO_BYTES, files: 1 },
});

/** Multipart `audio` field; raw float32 little-endian samples in memory only. */
export const uploadTranscriptionAudio: RequestHandler = (req, res, next) => {
  upload.single("audio")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: `audio exceeds ${MAX_TRANSCRIPTION_AUDIO_BYTES} byte limit`,
      });
      return;
    }
    next(err);
  });
};

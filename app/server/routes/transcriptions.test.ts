import type { Server } from "http";
import { readdirSync } from "fs";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createTranscriptionsRouter } from "./transcriptions.js";

let server: Server;
let baseUrl: string;
let isAvailable: boolean;
let transcribeImpl: (samples: Float32Array, sampleRate: number) => Promise<string>;
let cleanImpl: (text: string) => Promise<string>;

function float32Blob(values: number[]): Blob {
  const samples = Float32Array.from(values);
  return new Blob([samples.buffer], { type: "application/octet-stream" });
}

async function postTranscription(body: FormData | undefined): Promise<Response> {
  return fetch(`${baseUrl}/api/transcriptions`, {
    method: "POST",
    body,
  });
}

beforeEach(async () => {
  isAvailable = true;
  transcribeImpl = async () => "raw transcript";
  cleanImpl = async (text) => `cleaned: ${text}`;

  const router = createTranscriptionsRouter({
    isTranscriptionAvailable: async () => isAvailable,
    transcriptionCapability: async () =>
      isAvailable
        ? { available: true }
        : { available: false, reason: "ASR model is not provisioned" },
    transcribe: (samples, sampleRate) => transcribeImpl(samples, sampleRate),
    cleanTranscript: (text) => cleanImpl(text),
  });

  const app = express();
  app.use("/api/transcriptions", router);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe("GET /api/transcriptions/capability", () => {
  it("reflects availability when the model is provisioned", async () => {
    isAvailable = true;
    const res = await fetch(`${baseUrl}/api/transcriptions/capability`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
  });

  it("returns unavailable with a reason when the model is missing", async () => {
    isAvailable = false;
    const res = await fetch(`${baseUrl}/api/transcriptions/capability`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      available: false,
      reason: "ASR model is not provisioned",
    });
  });
});

describe("POST /api/transcriptions", () => {
  it("returns cleaned text for a well-formed upload", async () => {
    const form = new FormData();
    form.append("audio", float32Blob([0.1, -0.2, 0.3]), "audio.raw");

    const res = await postTranscription(form);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "cleaned: raw transcript" });
  });

  it("passes float32 samples to transcribe at 16 kHz", async () => {
    const samples = Float32Array.from([0.5, -0.25]);
    let receivedSamples: Float32Array | undefined;
    let receivedRate: number | undefined;
    transcribeImpl = async (s, rate) => {
      receivedSamples = s;
      receivedRate = rate;
      return "heard";
    };

    const form = new FormData();
    form.append(
      "audio",
      new Blob([samples.buffer], { type: "application/octet-stream" }),
      "audio.raw",
    );
    await postTranscription(form);

    expect(receivedRate).toBe(16_000);
    expect(Array.from(receivedSamples ?? [])).toEqual([0.5, -0.25]);
  });

  it("responds 503 with a reason when transcription is unavailable", async () => {
    isAvailable = false;
    const form = new FormData();
    form.append("audio", float32Blob([0.1]), "audio.raw");

    const res = await postTranscription(form);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "ASR model is not provisioned",
    });
  });

  it("responds 502 when transcription fails", async () => {
    transcribeImpl = async () => {
      throw new Error("decode failed");
    };
    const form = new FormData();
    form.append("audio", float32Blob([0.1]), "audio.raw");

    const res = await postTranscription(form);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "decode failed" });
  });

  it("does not write temp files during a request", async () => {
    const before = new Set(readdirSync(tmpdir()));

    const form = new FormData();
    form.append("audio", float32Blob([0.1, 0.2]), "audio.raw");
    const res = await postTranscription(form);
    expect(res.status).toBe(200);

    const after = readdirSync(tmpdir());
    const created = after.filter((name) => !before.has(name));
    expect(created).toEqual([]);
  });
});

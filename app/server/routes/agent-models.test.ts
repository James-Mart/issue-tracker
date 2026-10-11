import type { Server } from "http";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { resetAgentModelSlugsForTests } from "../agent-model-slugs.js";
import { CursorAgentError } from "../services/agent-sdk.js";
import { createFakeAgentSdk } from "../services/agent-sdk.fake.js";
import { createAgentModelsRouter } from "./agent-models.js";

let server: Server;
let baseUrl: string;
let catalogRoot: string;

beforeEach(async () => {
  catalogRoot = mkdtempSync(join(tmpdir(), "agent-models-route-"));
  const failingSdk = {
    ...createFakeAgentSdk(),
    async listModels(): Promise<never> {
      throw new CursorAgentError("Invalid API key");
    },
  };
  const app = express();
  app.use(
    "/api/agent-models",
    createAgentModelsRouter(failingSdk, {
      catalogPath: join(catalogRoot, "model-slug-catalog.json"),
    }),
  );

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
  resetAgentModelSlugsForTests();
  rmSync(catalogRoot, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe("GET /api/agent-models", () => {
  it("responds 502 with JSON error on CursorAgentError without crashing", async () => {
    const res = await fetch(`${baseUrl}/api/agent-models`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Invalid API key" });
  });
});

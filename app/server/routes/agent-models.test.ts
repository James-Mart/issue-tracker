import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { CursorAgentError } from "../services/agent-sdk.js";
import { createFakeAgentSdk, FAKE_MODELS } from "../services/agent-sdk.fake.js";
import { createAgentModelsRouter } from "./agent-models.js";

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const fake = createFakeAgentSdk();
  const app = express();
  app.use("/api/agent-models", createAgentModelsRouter(fake));

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

describe("GET /api/agent-models", () => {
  it("returns models from the SDK boundary with extra fields", async () => {
    const res = await fetch(`${baseUrl}/api/agent-models`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ models: FAKE_MODELS });
    expect(body.models[0].id).toBe("composer-2.5");
    expect(body.models[0].displayName).toBe("Composer 2.5");
  });

  it("responds 502 with JSON error on CursorAgentError without crashing", async () => {
    const failingSdk = {
      async listModels() {
        throw new CursorAgentError("Invalid API key");
      },
      async createAgent() {
        throw new Error("not used");
      },
      async resumeAgent() {
        throw new Error("not used");
      },
    };
    const app = express();
    app.use("/api/agent-models", createAgentModelsRouter(failingSdk));

    const errServer = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = errServer.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected TCP listen address");
    }
    const errBaseUrl = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(`${errBaseUrl}/api/agent-models`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Invalid API key" });

    await new Promise<void>((resolve, reject) => {
      errServer.close((err) => (err ? reject(err) : resolve()));
    });
  });
});

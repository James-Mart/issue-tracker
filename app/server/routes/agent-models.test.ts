import type { Server } from "http";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import {
  isAllowedAgentModelSlug,
  resetAgentModelSlugsForTests,
} from "../agent-model-slugs.js";
import { CursorAgentError } from "../services/agent-sdk.js";
import { createFakeAgentSdk, FAKE_MODELS } from "../services/agent-sdk.fake.js";
import { createAgentModelsRouter } from "./agent-models.js";

let server: Server;
let baseUrl: string;
let catalogRoot: string | undefined;
let catalogPath: string;
let listModelsCalls: number;

beforeEach(async () => {
  catalogRoot = mkdtempSync(join(tmpdir(), "agent-models-route-"));
  catalogPath = join(catalogRoot, "model-slug-catalog.json");
  listModelsCalls = 0;
  const fake = createFakeAgentSdk();
  const countingSdk = {
    ...fake,
    async listModels() {
      listModelsCalls += 1;
      return fake.listModels();
    },
  };
  const app = express();
  app.use(
    "/api/agent-models",
    createAgentModelsRouter(countingSdk, { catalogPath }),
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
  if (catalogRoot) {
    rmSync(catalogRoot, { recursive: true, force: true });
    catalogRoot = undefined;
  }
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
    expect(isAllowedAgentModelSlug("composer-2.5")).toBe(true);
    expect(isAllowedAgentModelSlug("auto")).toBe(true);
  });

  it("serves a second GET from the catalog cache without another listModels", async () => {
    const first = await fetch(`${baseUrl}/api/agent-models`);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.models[0].id).toBe("composer-2.5");
    expect(firstBody.models[0].displayName).toBe("Composer 2.5");
    expect(listModelsCalls).toBe(1);

    const second = await fetch(`${baseUrl}/api/agent-models`);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toEqual({ models: FAKE_MODELS });
    expect(secondBody.models[0].id).toBe("composer-2.5");
    expect(secondBody.models[0].displayName).toBe("Composer 2.5");
    expect(listModelsCalls).toBe(1);
  });

  it("responds 502 with JSON error on CursorAgentError without crashing", async () => {
    const failingCatalogRoot = mkdtempSync(
      join(tmpdir(), "agent-models-fail-"),
    );
    const failingCatalogPath = join(
      failingCatalogRoot,
      "model-slug-catalog.json",
    );
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
    app.use(
      "/api/agent-models",
      createAgentModelsRouter(failingSdk, { catalogPath: failingCatalogPath }),
    );

    const errServer = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = errServer.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected TCP listen address");
    }
    const errBaseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const res = await fetch(`${errBaseUrl}/api/agent-models`);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "Invalid API key" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        errServer.close((err) => (err ? reject(err) : resolve()));
      });
      rmSync(failingCatalogRoot, { recursive: true, force: true });
    }
  });
});

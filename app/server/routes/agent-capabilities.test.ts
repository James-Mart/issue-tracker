import { createServer, type Server } from "http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { CapabilityCatalog } from "../services/capability-catalog.js";
import { createAgentCapabilitiesRouter } from "./agent-capabilities.js";

const catalog: CapabilityCatalog = {
  sharedDefault: {
    id: "default",
    kind: "default",
    title: "Shared default",
    contract: {
      settingSources: [],
      inject: [],
      customTools: ["delegate"],
      builtins: ["read"],
      mcp: ["playwright"],
    },
  },
  profiles: [],
  roles: [],
};

describe("GET /api/agent-capabilities", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    const closing = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => {
      closing.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns the capability catalog", async () => {
    const app = express();
    app.use(
      "/api/agent-capabilities",
      createAgentCapabilitiesRouter(() => catalog),
    );
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected a TCP port");
    }
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/agent-capabilities`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(catalog);
  });
});

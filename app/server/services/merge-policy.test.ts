import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-merge-policy-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function loadService() {
  return import("./issues.js");
}

describe("project mergePolicy", () => {
  it("defaults to manual when absent on disk", async () => {
    const { read } = await loadService();
    const detail = read("p");
    expect(detail.kind).toBe("project");
    if (detail.kind === "project") {
      expect(detail.mergePolicy).toBe("manual");
    }
    const raw = JSON.parse(readFileSync(join(dir, "p", "issue.json"), "utf8"));
    expect(raw).not.toHaveProperty("mergePolicy");
  });

  it("defaults to manual on create", async () => {
    const { create, read } = await loadService();
    const record = await create({ kind: "project", title: "New" });
    const detail = read(record.id);
    expect(detail.kind).toBe("project");
    if (detail.kind === "project") {
      expect(detail.mergePolicy).toBe("manual");
    }
  });

  it("accepts mergePolicy on create", async () => {
    const { create, read } = await loadService();
    const record = await create({
      kind: "project",
      title: "PR policy",
      mergePolicy: "pull-request",
    });
    const detail = read(record.id);
    expect(detail.kind).toBe("project");
    if (detail.kind === "project") {
      expect(detail.mergePolicy).toBe("pull-request");
    }
    const raw = JSON.parse(readFileSync(join(dir, record.id, "issue.json"), "utf8"));
    expect(raw.mergePolicy).toBe("pull-request");
  });

  it("round-trips each policy through update and read", async () => {
    const { update, read } = await loadService();
    for (const policy of ["merge", "pull-request", "manual"] as const) {
      await update("p", { mergePolicy: policy });
      const detail = read("p");
      expect(detail.kind).toBe("project");
      if (detail.kind === "project") {
        expect(detail.mergePolicy).toBe(policy);
      }
      const raw = JSON.parse(readFileSync(join(dir, "p", "issue.json"), "utf8"));
      expect(raw.mergePolicy).toBe(policy);
    }
  });

  it("rejects an unknown merge policy", async () => {
    const { update } = await loadService();
    await expect(update("p", { mergePolicy: "rebase" as "manual" })).rejects.toThrow(
      /mergePolicy/i,
    );
  });

  it("rejects clearing mergePolicy with null", async () => {
    const { update } = await loadService();
    await update("p", { mergePolicy: "merge" });
    await expect(update("p", { mergePolicy: null })).rejects.toThrow(
      /mergePolicy cannot be cleared/i,
    );
  });

  it("rejects mergePolicy on a non-project issue", async () => {
    writeIssue("e", {
      kind: "epic",
      title: "E",
      partOf: "p",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const { update } = await loadService();
    await expect(update("e", { mergePolicy: "merge" })).rejects.toThrow(/mergePolicy/i);
  });
});

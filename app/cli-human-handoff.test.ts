import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  dir,
  env,
  issueJsonField,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";

const REQUEST = [
  "- Secret `API_KEY`: sandbox key from the vendor",
  "- Input: the public webhook URL",
].join("\n");

useCliTestFixtures();

function seedStory(): void {
  writeIssue("p", {
    kind: "project",
    title: "Proj",
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
  writeIssue("s", {
    kind: "story",
    title: "Story",
    partOf: "p",
    order: 0,
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
}

function commentLines(): Record<string, unknown>[] {
  return readFileSync(join(dir, "s", "comments.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("story request-human and human-done", () => {
  beforeEach(() => {
    seedStory();
  });

  it("lists both verbs in story help", async () => {
    const help = await runIssueCli(["story", "--help"], { env: env() });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("request-human");
    expect(help.stdout).toContain("human-done");
    expect(help.stdout).toContain("awaiting-human");
  });

  it("posts from a file and from stdin, then clears review", async () => {
    const path = join(dir, "request.md");
    writeFileSync(path, `${REQUEST}\n`);

    const requested = await runIssueCli(
      ["story", "request-human", "s", "--file", path],
      { env: env() },
    );
    expect(requested.status).toBe(0);
    expect(requested.stdout.trim()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(issueJsonField("s", "review")).toBe("awaiting-human");

    const again = await runIssueCli(
      ["story", "request-human", "s", "--file", "-"],
      { env: env(), stdin: REQUEST },
    );
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("review is already awaiting-human");

    const done = await runIssueCli(
      ["story", "human-done", "s", "--note", "key is set"],
      { env: env() },
    );
    expect(done.status).toBe(0);
    expect(issueJsonField("s", "review")).toBeUndefined();

    const lines = commentLines();
    expect(lines[0]).toMatchObject({
      id: requested.stdout.trim(),
      role: "story-review",
      type: "human-request",
      body: REQUEST,
    });
    expect(lines[0]?.replyTo).toBeUndefined();
    expect(lines[1]).toMatchObject({
      id: done.stdout.trim(),
      role: "human",
      type: "human-response",
      body: "key is set",
      replyTo: requested.stdout.trim(),
    });

    const view = await runIssueCli(["story", "view", "s", "--comments"], {
      env: env(),
    });
    expect(view.status).toBe(0);
    expect(view.stdout).toContain(
      `${requested.stdout.trim()} [${String(lines[0]?.at)}] story-review (human-request): ${REQUEST}`,
    );
    expect(view.stdout).toContain(
      `  ${done.stdout.trim()} [${String(lines[1]?.at)}] human (human-response): key is set`,
    );

    const early = await runIssueCli(["story", "human-done", "s"], { env: env() });
    expect(early.status).toBe(1);
    expect(early.stderr).toContain("review is not awaiting-human");
  });

  it("names the first bad item from stdin", async () => {
    const result = await runIssueCli(
      ["story", "request-human", "s", "--file", "-"],
      {
        env: env(),
        stdin: "- Input: ok\n- Secret `nope`: bad\n",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "request item does not follow the Request format: Secret `nope`: bad",
    );
    expect(issueJsonField("s", "review")).toBeUndefined();
  });

  it("requires --file", async () => {
    const result = await runIssueCli(["story", "request-human", "s"], {
      env: env(),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--file/);
  });
});

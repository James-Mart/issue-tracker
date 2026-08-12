import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  independentBootstrapFaultEntryProblem,
  productionModuleScriptSrcs,
} from "./bootstrap-fault-entry.js";

const indexHtml = readFileSync(
  fileURLToPath(new URL("../index.html", import.meta.url)),
  "utf8",
);
const mainTsx = readFileSync(
  fileURLToPath(new URL("../src/main.tsx", import.meta.url)),
  "utf8",
);

describe("bootstrap-fault production entry contract", () => {
  it("loads bootstrap-fault as its own module before main in index.html", () => {
    expect(productionModuleScriptSrcs(indexHtml)).toEqual([
      "/src/app/bootstrap-fault.ts",
      "/src/main.tsx",
    ]);
  });

  it("keeps main.tsx from importing bootstrap-fault (separate Rollup graphs)", () => {
    expect(mainTsx).not.toMatch(/from ["']@\/app\/bootstrap-fault["']/);
  });

  it("rejects a single merged production bundle", () => {
    const html =
      '<script type="module" crossorigin src="/assets/index-abc.js"></script>';
    expect(independentBootstrapFaultEntryProblem(html)).toMatch(
      /separate production module/,
    );
  });

  it("accepts independent production module scripts", () => {
    const html = `
      <script type="module" src="/assets/bootstrap-fault-aaa.js"></script>
      <script type="module" src="/assets/index-bbb.js"></script>
    `;
    expect(independentBootstrapFaultEntryProblem(html)).toBeUndefined();
  });
});

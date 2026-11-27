import { describe, expect, it } from "vitest";
import { rewriteSdkShellBinding } from "./sdk-shell-host-binding.js";

const BUILDS = [
  `const p=e.overrideShellExecutor??(!0===e.suppressDefaultShellExecutor?void 0:new WD(this.permissionsService,u,this.ignoreService,this.pendingDecisionStore));`,
  `const p=e.overrideShellExecutor??(!0===e.suppressDefaultShellExecutor?void 0:new GD(this.permissionsService,u,this.ignoreService,this.pendingDecisionStore));`,
  `let f=e.overrideShellExecutor??(e.suppressDefaultShellExecutor===!0?void 0:new Tft(this.permissionsService,c,this.ignoreService,this.pendingDecisionStore));`,
];

describe("rewriteSdkShellBinding", () => {
  it("passes the SDK shell into the registered executor and still builds it when unset", () => {
    for (const source of BUILDS) {
      const rewritten = rewriteSdkShellBinding(source);
      expect(rewritten).toBeDefined();
      expect(rewritten).toContain("function hostShellBound(user,hostShell)");
      expect(rewritten).toContain("user.execute(...n,hostShell)");
      expect(rewritten).not.toContain("e.overrideShellExecutor??");
      new Function(rewritten!);
      expect(rewriteSdkShellBinding(rewritten!)).toBeUndefined();
    }
  });
});

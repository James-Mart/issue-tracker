import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import {
  parseRunsInFlightRefusal,
  restartLiveTurnsMessage,
} from "./restart-refusal";

describe("parseRunsInFlightRefusal", () => {
  it("reads activeRuns from a runs-in-flight 409", () => {
    expect(
      parseRunsInFlightRefusal(
        new ApiError("conflict", 409, {
          code: "runs-in-flight",
          activeRuns: [
            { conversationId: "conv-1" },
            { conversationId: "conv-2" },
          ],
        }),
      ),
    ).toEqual({
      activeRuns: [
        { conversationId: "conv-1" },
        { conversationId: "conv-2" },
      ],
    });
  });

  it("returns undefined for other errors", () => {
    expect(parseRunsInFlightRefusal(new Error("nope"))).toBeUndefined();
    expect(
      parseRunsInFlightRefusal(
        new ApiError("conflict", 409, { code: "not-supervised" }),
      ),
    ).toBeUndefined();
    expect(
      parseRunsInFlightRefusal(new ApiError("bad", 500, {})),
    ).toBeUndefined();
  });
});

describe("restartLiveTurnsMessage", () => {
  it("names the count and that the loss is immediate", () => {
    expect(restartLiveTurnsMessage(1)).toBe(
      "Restarting now will drop 1 agent turn immediately. That work is not recovered.",
    );
    expect(restartLiveTurnsMessage(3)).toBe(
      "Restarting now will drop 3 agent turns immediately. That work is not recovered.",
    );
  });
});

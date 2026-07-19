import { describe, expect, it } from "vitest";
import { initiativeRecord, normalizeWorkboard } from "./workboard.js";

describe("Workboard P1 adapter", () => {
  it("accepts the staged Ready, Waiting, and Done lane shape", () => {
    const board = normalizeWorkboard({ ready: [{ id: "r1" }], waiting: [{ id: "w1" }], done: [{ id: "d1" }] });
    expect(board.ready).toHaveLength(1);
    expect(board.waiting).toHaveLength(1);
    expect(board.done).toHaveLength(1);
  });

  it("maps the current API lanes into the P1 view", () => {
    const board = normalizeWorkboard({
      active: [{ id: "r1" }],
      waiting_for_jim: [{ id: "w1" }],
      waiting_for_agent: [{ id: "w2" }],
      paused_or_done: [{ id: "d1" }],
    });
    expect(board.ready.map((item) => item.id)).toEqual(["r1"]);
    expect(board.waiting.map((item) => item.id)).toEqual(["w1", "w2"]);
    expect(board.done.map((item) => item.id)).toEqual(["d1"]);
  });

  it("keeps omitted staged card fields visibly absent instead of guessing", () => {
    expect(initiativeRecord({ next_step: "Review the diff", owner: "" })).toEqual({
      owner: null,
      nextAction: "Review the diff",
      blocker: null,
      recentFact: null,
      recordLanguage: null,
    });
  });
});

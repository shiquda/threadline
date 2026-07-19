import { describe, expect, it } from "vitest";
import { initiativeRecord, normalizeWorkboard, uniqueInitiativeIds } from "./workboard.js";

describe("Workboard adapter", () => {
  it("accepts the staged canonical lane shape", () => {
    const board = normalizeWorkboard({
      in_progress: [{ id: "r1" }],
      waiting_for_user: [{ id: "w1" }],
      waiting_for_agent: [{ id: "w2" }],
      paused_or_done: [{ id: "d1" }],
    });
    expect(board.in_progress).toHaveLength(1);
    expect(board.waiting_for_user).toHaveLength(1);
    expect(board.waiting_for_agent).toHaveLength(1);
    expect(board.paused_or_done).toHaveLength(1);
  });

  it("maps the current API lanes into the product-brief view", () => {
    const board = normalizeWorkboard({
      active: [{ id: "r1" }],
      waiting_for_jim: [{ id: "w1" }],
      waiting_for_agent: [{ id: "w2" }],
      paused_or_done: [{ id: "d1" }],
    });
    expect(board.in_progress.map((item) => item.id)).toEqual(["r1"]);
    expect(board.waiting_for_user.map((item) => item.id)).toEqual(["w1"]);
    expect(board.waiting_for_agent.map((item) => item.id)).toEqual(["w2"]);
    expect(board.paused_or_done.map((item) => item.id)).toEqual(["d1"]);
  });

  it("splits legacy combined ready lane by record status", () => {
    const board = normalizeWorkboard({
      ready: [
        { id: "active-1", status: "active" },
        { id: "jim-1", status: "waiting_for_jim" },
        { id: "agent-1", status: "waiting_for_agent" },
      ],
      done: [{ id: "done-1", status: "completed" }],
    });
    expect(board.in_progress.map((item) => item.id)).toEqual(["active-1"]);
    expect(board.waiting_for_user.map((item) => item.id)).toEqual(["jim-1"]);
    expect(board.waiting_for_agent.map((item) => item.id)).toEqual(["agent-1"]);
    expect(board.paused_or_done.map((item) => item.id)).toEqual(["done-1"]);
  });

  it("does not duplicate a record that appears in both ready and a specific lane", () => {
    const board = normalizeWorkboard({
      ready: [{ id: "agent-1", status: "waiting_for_agent" }],
      active: [{ id: "active-1", status: "active" }],
      waiting_for_agent: [{ id: "agent-1", status: "waiting_for_agent" }],
      paused_or_done: [{ id: "done-1", status: "completed" }],
    });
    expect(board.in_progress.map((item) => item.id)).toEqual(["active-1"]);
    expect(board.waiting_for_agent.map((item) => item.id)).toEqual(["agent-1"]);
    expect(board.paused_or_done.map((item) => item.id)).toEqual(["done-1"]);
  });

  it("counts unique initiatives across all lanes", () => {
    const board = normalizeWorkboard({
      active: [{ id: "a" }],
      ready: [{ id: "a" }],
      waiting_for_jim: [{ id: "b" }],
      waiting_for_agent: [{ id: "c" }],
      paused_or_done: [{ id: "b" }],
    });
    expect(uniqueInitiativeIds(board).size).toBe(3);
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

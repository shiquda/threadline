import { describe, expect, it } from "vitest";
import { applyHashParams, hashWithParams } from "./url-params.js";

describe("URL hash params", () => {
  it("keeps explicit all values instead of deleting them", () => {
    const params = applyHashParams(new URLSearchParams(), { scope: "all", filter: "all" });
    expect(params.get("scope")).toBe("all");
    expect(params.get("filter")).toBe("all");
  });

  it("deletes null or empty values", () => {
    const params = applyHashParams(new URLSearchParams("filter=decision&q=foo"), { filter: null, q: "" });
    expect(params.has("filter")).toBe(false);
    expect(params.has("q")).toBe(false);
  });

  it("overwrites existing values", () => {
    const params = applyHashParams(new URLSearchParams("filter=open"), { filter: "resolved" });
    expect(params.get("filter")).toBe("resolved");
  });

  it("builds a hash with or without a query string", () => {
    expect(hashWithParams("inbox", new URLSearchParams("filter=decision"))).toBe("#inbox?filter=decision");
    expect(hashWithParams("inbox", new URLSearchParams())).toBe("#inbox");
  });
});

import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { CreateSubmissionInputSchema } from "../src/index.js";

const actor = { actor_type: "agent", actor_name: "builder" };

describe("core protocol schemas", () => {
  it("accepts BCP 47 content language and evidence references", () => {
    expect(
      Value.Check(CreateSubmissionInputSchema, {
        kind: "delivery",
        title: "Published implementation",
        summary: "The durable record is ready.",
        content_language: "zh-Hans-CN",
        evidence_refs: ["git:abc123", "https://example.test/checks/42"],
        attention_policy: "record_only",
        actor,
      }),
    ).toBe(true);
  });

  it("rejects malformed content language tags", () => {
    expect(
      Value.Check(CreateSubmissionInputSchema, {
        kind: "delivery",
        title: "Published implementation",
        summary: "The durable record is ready.",
        content_language: "en_US",
        attention_policy: "record_only",
        actor,
      }),
    ).toBe(false);
  });

  it("supports BCP 47 extensions and private-use tags", () => {
    for (const content_language of ["en-u-ca-gregory", "x-team-private"]) {
      expect(
        Value.Check(CreateSubmissionInputSchema, {
          kind: "delivery",
          title: "Published implementation",
          summary: "The durable record is ready.",
          content_language,
          attention_policy: "record_only",
          actor,
        }),
      ).toBe(true);
    }
  });
});

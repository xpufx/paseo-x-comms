import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeToolCall } from "./tool-call.ts";

function item(overrides: Record<string, unknown> = {}) {
  return {
    name: "x_comms_send",
    status: "completed",
    detail: {
      type: "unknown",
      input: { daemon: "hsi", agentId: "agent_1", prompt: "hi" },
      output: { ok: true },
    },
    ...overrides,
  };
}

describe("tool-call mapping", () => {
  it("ignores non x_comms tools", () => {
    assert.equal(summarizeToolCall(item({ name: "read" })), null);
    assert.equal(summarizeToolCall(item({ name: "xcomms_send" })), null);
  });

  it("matches registration-prefixed names and shortens them", () => {
    const out = summarizeToolCall(item({ name: "paseo_cross_daemon_send" }));
    assert.ok(out);
    assert.equal(out.tool, "x_comms_send");
  });

  it("maps alias daemon plus agent", () => {
    const out = summarizeToolCall(item());
    assert.ok(out);
    assert.equal(out.tool, "x_comms_send");
    assert.equal(out.targetAlias, "hsi");
    assert.equal(out.targetServerId, null);
    assert.equal(out.agentId, "agent_1");
    assert.equal(out.failed, false);
  });

  it("maps srv_ daemon as server id, not alias", () => {
    const out = summarizeToolCall(item({
      detail: { type: "unknown", input: { daemon: "srv_abc", agentId: "a1" }, output: null },
    }));
    assert.ok(out);
    assert.equal(out.targetAlias, null);
    assert.equal(out.targetServerId, "srv_abc");
  });

  it("prefers explicit serverId field", () => {
    const out = summarizeToolCall(item({
      detail: { type: "unknown", input: { serverId: "srv_x", agentId: "a1" }, output: null },
    }));
    assert.ok(out);
    assert.equal(out.targetServerId, "srv_x");
  });

  it("marks failed and canceled calls and surfaces the error", () => {
    const failed = summarizeToolCall(item({ status: "failed", error: "boom" }));
    assert.ok(failed?.failed);
    assert.equal(failed?.output, "boom");
    const canceled = summarizeToolCall(item({ status: "canceled" }));
    assert.ok(canceled?.failed);
  });

  it("truncates long output instead of rendering walls", () => {
    const out = summarizeToolCall(item({
      detail: { type: "unknown", input: {}, output: "x".repeat(5000) },
    }));
    assert.ok(out?.output);
    assert.ok((out?.output ?? "").length < 5000);
    assert.match(out?.output ?? "", /truncated/);
  });

  it("returns null output when the call carries none", () => {
    const out = summarizeToolCall(item({
      detail: { type: "unknown", input: {}, output: null },
    }));
    assert.equal(out?.output, null);
  });

  it("tolerates missing or malformed detail", () => {
    assert.ok(summarizeToolCall(item({ detail: undefined })));
    assert.ok(summarizeToolCall(item({ detail: "nonsense" })));
  });
});

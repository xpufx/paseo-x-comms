import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cardSignal, isOverflowing, viewerDirection, COLLAPSED_LINES, type CrossDaemonEnvelope } from "./envelope.ts";

function envelope(senderAgentId: string | null): CrossDaemonEnvelope {
  return {
    xComms: {
      version: 4,
      type: "x-comms.message",
      direction: "outgoing",
      sender: {
        agentId: senderAgentId,
        agentName: "Someone",
        host: "h",
        daemonServerId: "srv_x",
        cwd: null,
      },
      target: { daemon: "local", agentId: "me" },
      sentAt: "2026-09-09T10:00:00.000Z",
    },
  };
}

describe("message direction signal", () => {
  it("user-sent (self) renders red", () => {
    const signal = cardSignal(envelope("me"), "me");
    assert.equal(signal.direction, "outgoing");
    assert.equal(signal.userSent, true);
  });

  it("agent-sent (peer) renders neutral, never red", () => {
    const signal = cardSignal(envelope("peer-1"), "me");
    assert.equal(signal.direction, "incoming");
    assert.equal(signal.userSent, false);
  });

  it("missing sender id defaults to neutral incoming", () => {
    const signal = cardSignal(envelope(null), "me");
    assert.equal(signal.direction, "incoming");
    assert.equal(signal.userSent, false);
  });

  it("viewerDirection matches cardSignal", () => {
    assert.equal(viewerDirection(envelope("me"), "me"), "outgoing");
    assert.equal(viewerDirection(envelope("peer-1"), "me"), "incoming");
  });

  it("overflow rule: only long bodies get a toggle", () => {
    assert.equal(COLLAPSED_LINES, 3);
    assert.equal(isOverflowing(1), false);
    assert.equal(isOverflowing(3), false);
    assert.equal(isOverflowing(4), true);
    assert.equal(isOverflowing(40), true);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveConversationThreads,
  mergeMessages,
  threadKeyForCounterparty,
  type ConversationMessage,
} from "./conversations.ts";

function envelope(senderAgentId: string, sentAt: string): string {
  const payload = {
    xComms: {
      version: 4,
      type: "x-comms.incoming_message",
      direction: "outgoing",
      sender: {
        agentId: senderAgentId,
        agentName: "Remote",
        host: "remote-host",
        daemonServerId: "srv_remote",
        cwd: null,
      },
      target: { daemon: "local", agentId: "me" },
      sentAt,
    },
  };
  return `[x-comms] ${JSON.stringify(payload)}\n\nhello at ${sentAt}`;
}

function mockPaseo(texts: string[]) {
  return {
    agents: {
      ref: () => ({
        timeline: {
          refetch: async () => ({
            entries: texts.map((text) => ({ item: { type: "user_message", text } })),
          }),
        },
      }),
    },
  };
}

function sent(id: string, sentAt: string): ConversationMessage {
  return { id, body: `out ${sentAt}`, sentAt, isIncoming: false, senderName: "You", daemon: "hsi" };
}

describe("conversation threads", () => {
  it("groups envelope messages into one incoming thread", async () => {
    const paseo = mockPaseo([
      envelope("peer-1", "2026-09-09T10:00:00.000Z"),
      envelope("peer-1", "2026-09-09T10:05:00.000Z"),
    ]);
    const threads = await deriveConversationThreads(paseo as never, "me");
    assert.equal(threads.length, 1);
    assert.equal(threads[0].partner.conversationId, "srv_remote/peer-1");
    assert.equal(threads[0].messages.length, 2);
    assert.ok(threads[0].messages.every((m) => m.isIncoming));
  });

  it("keys picker targets exactly like derived threads", async () => {
    const paseo = mockPaseo([envelope("peer-1", "2026-09-09T10:00:00.000Z")]);
    const threads = await deriveConversationThreads(paseo as never, "me");
    const picked = threadKeyForCounterparty({ daemon: "hsi", daemonServerId: "srv_remote", agentId: "peer-1" });
    assert.equal(picked, threads[0].partner.conversationId);
  });

  it("a bare alias key never matches: the old picker bug", () => {
    const buggy = "hsi/peer-1";
    const derived = threadKeyForCounterparty({ daemon: "remote-host", daemonServerId: "srv_remote", agentId: "peer-1" });
    assert.notEqual(buggy, derived);
    assert.equal(derived, "srv_remote/peer-1");
  });

  it("merges both directions interleaved by timestamp", async () => {
    const paseo = mockPaseo([
      envelope("peer-1", "2026-09-09T10:00:00.000Z"),
      envelope("peer-1", "2026-09-09T10:10:00.000Z"),
    ]);
    const threads = await deriveConversationThreads(paseo as never, "me");
    const all = mergeMessages(threads[0].messages, [
      sent("s1", "2026-09-09T10:05:00.000Z"),
      sent("s2", "2026-09-09T10:20:00.000Z"),
    ]);
    assert.equal(all.length, 4);
    assert.deepEqual(
      all.map((m) => m.isIncoming),
      [true, false, true, false],
    );
    assert.deepEqual(
      all.map((m) => m.sentAt),
      [...all.map((m) => m.sentAt)].sort(),
    );
  });

  it("merge keeps working when either side is empty", () => {
    assert.deepEqual(mergeMessages([], [sent("s1", "2026-09-09T10:05:00.000Z")]).length, 1);
    assert.deepEqual(mergeMessages([], []).length, 0);
  });
});

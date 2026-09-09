import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  XCommsConversationsSnapshotSchema,
  emptyConversationsSnapshot,
} from "../shared/conversations-snapshot.ts";
import {
  detachLocalAgent,
  prunePeer,
  readConversationsSnapshot,
  reconcileTimelines,
  recordSend,
  scanLocalTimelines,
  writeConversationsSnapshot,
  type TimelineOwnerLike,
} from "./conversations-snapshot.ts";

function envelope(senderAgentId: string, sentAt: string, serverId = "srv_remote"): string {
  const payload = {
    xComms: {
      version: 4,
      type: "x-comms.message",
      direction: "outgoing",
      sender: { agentId: senderAgentId, agentName: "Remote", host: "h", daemonServerId: serverId, cwd: null },
      target: { daemon: "local", agentId: "me" },
      sentAt,
    },
  };
  return `[x-comms] ${JSON.stringify(payload)}\n\nhello`;
}

function withSandboxedHome(fn: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "xcomms-home-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
}

function mockScanner(timelines: TimelineOwnerLike[]) {
  return {
    agents: {
      list: async () => ({ entries: timelines.map((t) => ({ agent: { id: t.ownerAgentId } })) }),
      ref: (id: string) => ({
        timeline: {
          refetch: async () => ({
            entries: timelines.find((t) => t.ownerAgentId === id)?.entries.map((e) => ({ item: e.item })) ?? [],
          }),
        },
      }),
    },
  };
}

describe("conversations snapshot", () => {
  it("validates a representative payload against the schema", () => {
    const payload = {
      version: 1,
      updatedAt: "2026-09-09T10:00:00.000Z",
      threads: [
        {
          peerAlias: "hsi",
          peerServerId: "srv_remote",
          peerAgentId: "peer-1",
          peerAgentName: "Remote",
          localAgentIds: ["me"],
          lastDirection: "incoming",
          lastTimestamp: "2026-09-09T10:00:00.000Z",
          lastReadAt: "2026-09-09T09:00:00.000Z",
          lastSeenAt: "2026-09-09T10:00:00.000Z",
          unreadCount: 2,
        },
      ],
    };
    const parsed = XCommsConversationsSnapshotSchema.safeParse(payload);
    assert.equal(parsed.success, true);
    assert.equal(XCommsConversationsSnapshotSchema.safeParse({ ...payload, version: 2 }).success, false);
  });

  it("records a send with zero unread and an advanced watermark", () => {
    const next = recordSend(emptyConversationsSnapshot(), {
      peerAlias: "hsi",
      peerServerId: "srv_remote",
      peerAgentId: "peer-1",
      peerAgentName: null,
      localAgentId: "me",
      at: "2026-09-09T10:00:00.000Z",
    });
    assert.equal(next.threads.length, 1);
    assert.equal(next.threads[0].lastDirection, "outgoing");
    assert.equal(next.threads[0].unreadCount, 0);
    assert.deepEqual(next.threads[0].localAgentIds, ["me"]);
  });

  it("reconciles receives from timelines without double-counting rescans", () => {
    const timelines: TimelineOwnerLike[] = [{
      ownerAgentId: "me",
      entries: [{ item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:00:00.000Z") } }],
    }];
    const once = reconcileTimelines(emptyConversationsSnapshot(), timelines, () => "hsi");
    assert.equal(once.threads.length, 1);
    assert.equal(once.threads[0].lastDirection, "incoming");
    assert.equal(once.threads[0].unreadCount, 1);
    const twice = reconcileTimelines(once, timelines, () => "hsi");
    assert.equal(twice.threads[0].unreadCount, 1);
  });

  it("counts only messages newer than the last scan", () => {
    const first: TimelineOwnerLike[] = [{
      ownerAgentId: "me",
      entries: [{ item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:00:00.000Z") } }],
    }];
    const once = reconcileTimelines(emptyConversationsSnapshot(), first, () => "hsi");
    assert.equal(once.threads[0].unreadCount, 1);
    const second: TimelineOwnerLike[] = [{
      ownerAgentId: "me",
      entries: [
        { item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:00:00.000Z") } },
        { item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:05:00.000Z") } },
      ],
    }];
    const twice = reconcileTimelines(once, second, () => "hsi");
    assert.equal(twice.threads[0].unreadCount, 2);
    assert.equal(twice.threads[0].lastTimestamp, "2026-09-09T10:05:00.000Z");
  });

  it("a send after receives resets unread", () => {
    const timelines: TimelineOwnerLike[] = [{
      ownerAgentId: "me",
      entries: [{ item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:00:00.000Z") } }],
    }];
    const received = reconcileTimelines(emptyConversationsSnapshot(), timelines, () => "hsi");
    const sent = recordSend(received, {
      peerAlias: "hsi",
      peerServerId: "srv_remote",
      peerAgentId: "peer-1",
      peerAgentName: null,
      localAgentId: "me",
      at: "2026-09-09T11:00:00.000Z",
    });
    assert.equal(sent.threads[0].unreadCount, 0);
    assert.equal(sent.threads[0].lastDirection, "outgoing");
  });

  it("scans local timelines through the structural scanner", async () => {
    const timelines: TimelineOwnerLike[] = [{
      ownerAgentId: "me",
      entries: [{ item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:00:00.000Z") } }],
    }];
    const scanned = await scanLocalTimelines(mockScanner(timelines));
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0].ownerAgentId, "me");
    assert.equal(scanned[0].entries.length, 1);
  });

  it("prunes threads on retract", () => {
    const full = recordSend(emptyConversationsSnapshot(), {
      peerAlias: "hsi",
      peerServerId: "srv_remote",
      peerAgentId: "peer-1",
      peerAgentName: null,
      localAgentId: "me",
      at: "2026-09-09T10:00:00.000Z",
    });
    const { snapshot, removed } = prunePeer(full, "srv_remote", "peer-1");
    assert.equal(removed, true);
    assert.equal(snapshot.threads.length, 0);
    assert.equal(prunePeer(full, "srv_other", "peer-1").removed, false);
  });

  it("detaches archived local agents and drops emptied threads", () => {
    let state = recordSend(emptyConversationsSnapshot(), {
      peerAlias: "hsi",
      peerServerId: "srv_remote",
      peerAgentId: "peer-1",
      peerAgentName: null,
      localAgentId: "me",
      at: "2026-09-09T10:00:00.000Z",
    });
    const untouched = detachLocalAgent(state, "someone-else");
    assert.equal(untouched.removed, false);
    assert.equal(untouched.snapshot.threads.length, 1);
    state = untouched.snapshot;
    const dropped = detachLocalAgent(state, "me");
    assert.equal(dropped.removed, true);
    assert.equal(dropped.snapshot.threads.length, 0);
  });

  it("persists and reloads the snapshot round-trip", () => {
    withSandboxedHome(() => {
      const written = recordSend(emptyConversationsSnapshot(), {
        peerAlias: "hsi",
        peerServerId: "srv_remote",
        peerAgentId: "peer-1",
        peerAgentName: "Remote",
        localAgentId: "me",
        at: "2026-09-09T10:00:00.000Z",
      });
      writeConversationsSnapshot(written);
      const read = readConversationsSnapshot();
      assert.equal(read.threads.length, 1);
      assert.equal(read.threads[0].peerAlias, "hsi");
      assert.equal(XCommsConversationsSnapshotSchema.safeParse(read).success, true);
    });
  });
});

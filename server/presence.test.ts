import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyAnnounce,
  applyRetract,
  emptyPresenceState,
  localLiveEntries,
  pendingForPeer,
  presenceKey,
  queueRetract,
  sweepExpired,
  PRESENCE_SEEN_CAP,
  PRESENCE_TTL_MS,
  type PresenceBirth,
} from "./presence.ts";

function birth(overrides: Partial<PresenceBirth> = {}): PresenceBirth {
  return {
    serverId: "srv_a",
    agentId: "agent_1",
    name: "Agent 1",
    provider: "opencode",
    timestamp: "2026-09-08T20:00:00.000Z",
    ...overrides,
  };
}

describe("presence store rules", () => {
  it("accepts a fresh birth and keys it by serverId/agentId", () => {
    const state = emptyPresenceState();
    const out = applyAnnounce(state, birth(), "m1", "local", "2026-09-08T20:00:01.000Z");
    assert.equal(out.result, "accepted");
    assert.ok(state.live[presenceKey("srv_a", "agent_1")]);
    assert.equal(state.live[presenceKey("srv_a", "agent_1")].origin, "local");
  });

  it("suppresses duplicate message ids", () => {
    const state = emptyPresenceState();
    assert.equal(applyAnnounce(state, birth(), "m1", "remote").result, "accepted");
    const out = applyAnnounce(state, birth({ name: "Changed" }), "m1", "remote");
    assert.equal(out.result, "duplicate");
    assert.equal(state.live[presenceKey("srv_a", "agent_1")].name, "Agent 1");
  });

  it("refuses a stale birth older than the live entry", () => {
    const state = emptyPresenceState();
    applyAnnounce(state, birth(), "m1", "remote");
    const out = applyAnnounce(state, birth({ timestamp: "2026-09-08T19:00:00.000Z", name: "Old" }), "m2", "remote");
    assert.equal(out.result, "refused-stale");
    assert.equal(state.live[presenceKey("srv_a", "agent_1")].name, "Agent 1");
  });

  it("tombstones on retract and refuses resurrection by older or equal births", () => {
    const state = emptyPresenceState();
    applyAnnounce(state, birth(), "m1", "remote");
    const r = applyRetract(state, "srv_a", "agent_1", "2026-09-08T21:00:00.000Z", "m2");
    assert.equal(r.applied, true);
    assert.ok(!state.live[presenceKey("srv_a", "agent_1")]);
    assert.equal(
      applyAnnounce(state, birth({ timestamp: "2026-09-08T20:30:00.000Z" }), "m3", "remote").result,
      "refused-tombstoned",
    );
    assert.equal(
      applyAnnounce(state, birth({ timestamp: "2026-09-08T21:00:00.000Z" }), "m4", "remote").result,
      "refused-tombstoned",
    );
    assert.ok(!state.live[presenceKey("srv_a", "agent_1")]);
  });

  it("accepts a strictly newer birth after a tombstone and clears it", () => {
    const state = emptyPresenceState();
    applyAnnounce(state, birth(), "m1", "remote");
    applyRetract(state, "srv_a", "agent_1", "2026-09-08T21:00:00.000Z", "m2");
    const out = applyAnnounce(state, birth({ timestamp: "2026-09-08T22:00:00.000Z" }), "m3", "remote");
    assert.equal(out.result, "accepted");
    assert.ok(state.live[presenceKey("srv_a", "agent_1")]);
    assert.ok(!state.tombstones[presenceKey("srv_a", "agent_1")]);
  });

  it("tombstones unknown agents so delayed births are refused", () => {
    const state = emptyPresenceState();
    applyRetract(state, "srv_a", "ghost", "2026-09-08T21:00:00.000Z", "m1");
    assert.equal(
      applyAnnounce(state, birth({ agentId: "ghost", timestamp: "2026-09-08T20:00:00.000Z" }), "m2", "remote").result,
      "refused-tombstoned",
    );
  });

  it("never forwards gossip: relay filter exposes local entries only", () => {
    const state = emptyPresenceState();
    applyAnnounce(state, birth({ agentId: "mine" }), "m1", "local");
    applyAnnounce(state, birth({ agentId: "theirs", serverId: "srv_b" }), "m2", "remote");
    const out = localLiveEntries(state);
    assert.equal(out.length, 1);
    assert.equal(out[0].agentId, "mine");
  });

  it("sweeps expired live entries and reports them for alerting", () => {
    const state = emptyPresenceState();
    applyAnnounce(state, birth(), "m1", "remote", "2026-09-01T00:00:00.000Z");
    const swept = sweepExpired(state, Date.parse("2026-09-08T20:00:00.000Z") );
    assert.deepEqual(swept.expiredLive, [presenceKey("srv_a", "agent_1")]);
    assert.ok(!state.live[presenceKey("srv_a", "agent_1")]);
  });

  it("does not sweep fresh entries", () => {
    const state = emptyPresenceState();
    const now = Date.parse("2026-09-08T20:00:00.000Z");
    applyAnnounce(state, birth(), "m1", "remote", "2026-09-08T20:00:00.000Z");
    const swept = sweepExpired(state, now + PRESENCE_TTL_MS - 1000);
    assert.deepEqual(swept.expiredLive, []);
    assert.ok(state.live[presenceKey("srv_a", "agent_1")]);
  });

  it("bounds the seen-id LRU", () => {
    const state = emptyPresenceState();
    for (let i = 0; i < PRESENCE_SEEN_CAP + 50; i++) {
      applyAnnounce(state, birth({ agentId: `a${i}` }), `m${i}`, "remote");
    }
    assert.ok(state.seenIds.length <= PRESENCE_SEEN_CAP);
  });

  it("dedupes queued retracts per peer and agent", () => {
    const state = emptyPresenceState();
    const base = { peer: "hsi", serverId: "srv_a", agentId: "agent_1", timestamp: "2026-09-08T21:00:00.000Z", queuedAt: "2026-09-08T21:00:01.000Z", attempts: 1 };
    queueRetract(state, { ...base, messageId: "r1" });
    queueRetract(state, { ...base, messageId: "r2" });
    assert.equal(pendingForPeer(state, "hsi").length, 1);
    assert.equal(pendingForPeer(state, "hsi")[0].messageId, "r2");
    assert.equal(pendingForPeer(state, "other").length, 0);
  });
});

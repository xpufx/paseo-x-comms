import { PluginStorage } from "paseo-plugin-helper/server";

/**
 * Presence store (mesh Layer 1, control plane only).
 *
 * Vocabulary follows docs/mesh.md: announce (birth), retract, tombstones.
 * Live entries are keyed by (serverId, agentId). Identity is never trusted
 * from a payload alone: receivers only accept entries whose serverId matches
 * an explicitly paired peer (seed links stay explicit).
 *
 * Anti-loop rules, in order of importance:
 * 1. Seen-id LRU, bounded: duplicates are dropped on arrival.
 * 2. Never forward gossip: only locally-originated events leave this daemon.
 *    Enforced by origin tracking plus a relay filter at the transport edge.
 * 3. Retract-before-reannounce with sticky tombstones: a birth older than
 *    (or simultaneous with) its tombstone is refused, so delayed births
 *    cannot resurrect the dead.
 * 4. TTL is purely a safety net: expiry sweeps live entries and reports an
 *    alert so a real bug surfaces instead of silently healing.
 */

export interface PresenceBirth {
  serverId: string;
  agentId: string;
  name: string;
  provider: string;
  timestamp: string;
}

export interface PresenceLiveEntry extends PresenceBirth {
  origin: "local" | "remote";
  lastSeenAt: string;
}

export interface PresenceTombstone {
  serverId: string;
  agentId: string;
  retractedAt: string;
}

export interface PendingRetract {
  peer: string;
  serverId: string;
  agentId: string;
  timestamp: string;
  messageId: string;
  queuedAt: string;
  attempts: number;
}

export interface PresenceState {
  live: Record<string, PresenceLiveEntry>;
  tombstones: Record<string, PresenceTombstone>;
  seenIds: string[];
  pendingRetracts: PendingRetract[];
}

export const PRESENCE_SEEN_CAP = 1000;
export const PRESENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PRESENCE_TOMBSTONE_TTL_MS = 2 * PRESENCE_TTL_MS;

export function presenceKey(serverId: string, agentId: string): string {
  return `${serverId}/${agentId}`;
}

export function emptyPresenceState(): PresenceState {
  return { live: {}, tombstones: {}, seenIds: [], pendingRetracts: [] };
}

function noteSeen(state: PresenceState, messageId: string): boolean {
  if (state.seenIds.includes(messageId)) return false;
  state.seenIds.push(messageId);
  while (state.seenIds.length > PRESENCE_SEEN_CAP) state.seenIds.shift();
  return true;
}

export type AnnounceOutcome =
  | { result: "accepted" }
  | { result: "duplicate" }
  | { result: "refused-tombstoned" }
  | { result: "refused-stale" };

/**
 * Apply one birth announcement. Returns the outcome; mutates state.
 * `nowIso` is injectable for tests.
 */
export function applyAnnounce(
  state: PresenceState,
  birth: PresenceBirth,
  messageId: string,
  origin: "local" | "remote",
  nowIso: string = new Date().toISOString(),
): AnnounceOutcome {
  if (!noteSeen(state, messageId)) return { result: "duplicate" };
  const key = presenceKey(birth.serverId, birth.agentId);
  const tombstone = state.tombstones[key];
  if (tombstone && birth.timestamp <= tombstone.retractedAt) {
    return { result: "refused-tombstoned" };
  }
  if (tombstone) delete state.tombstones[key];
  const existing = state.live[key];
  if (existing && birth.timestamp <= existing.timestamp) {
    return { result: "refused-stale" };
  }
  state.live[key] = { ...birth, origin, lastSeenAt: nowIso };
  return { result: "accepted" };
}

export type RetractOutcome = { applied: boolean; duplicate: boolean };

/**
 * Apply one retract. Always tombstones, even if no live entry exists, so a
 * delayed birth arriving later is refused. Mutates state.
 */
export function applyRetract(
  state: PresenceState,
  serverId: string,
  agentId: string,
  timestamp: string,
  messageId: string,
): RetractOutcome {
  if (!noteSeen(state, messageId)) return { applied: false, duplicate: true };
  const key = presenceKey(serverId, agentId);
  delete state.live[key];
  const prev = state.tombstones[key];
  if (!prev || timestamp > prev.retractedAt) {
    state.tombstones[key] = { serverId, agentId, retractedAt: timestamp };
  }
  return { applied: true, duplicate: false };
}

/**
 * Relay filter for the transport edge: only locally-originated live entries
 * may leave this daemon. Everything received via gossip stays local.
 */
export function localLiveEntries(state: PresenceState): PresenceLiveEntry[] {
  return Object.values(state.live).filter((entry) => entry.origin === "local");
}

/**
 * TTL sweep. Returns expired live keys and stale tombstone keys, and mutates
 * state by removing them. Callers must treat any non-empty result as an
 * alert: TTL firing means announcements or retracts stopped flowing.
 */
export function sweepExpired(
  state: PresenceState,
  nowMs: number = Date.now(),
): { expiredLive: string[]; expiredTombstones: string[] } {
  const expiredLive: string[] = [];
  for (const [key, entry] of Object.entries(state.live)) {
    if (nowMs - Date.parse(entry.lastSeenAt) > PRESENCE_TTL_MS) {
      delete state.live[key];
      expiredLive.push(key);
    }
  }
  const expiredTombstones: string[] = [];
  for (const [key, tomb] of Object.entries(state.tombstones)) {
    if (nowMs - Date.parse(tomb.retractedAt) > PRESENCE_TOMBSTONE_TTL_MS) {
      delete state.tombstones[key];
      expiredTombstones.push(key);
    }
  }
  return { expiredLive, expiredTombstones };
}

export function queueRetract(
  state: PresenceState,
  pending: PendingRetract,
): void {
  const key = presenceKey(pending.serverId, pending.agentId);
  state.pendingRetracts = state.pendingRetracts.filter(
    (p) => p.peer !== pending.peer || presenceKey(p.serverId, p.agentId) !== key,
  );
  state.pendingRetracts.push(pending);
}

export function pendingForPeer(state: PresenceState, peer: string): PendingRetract[] {
  return state.pendingRetracts.filter((p) => p.peer === peer);
}

const presenceStore = new PluginStorage<PresenceState>("paseo-x-comms", "presence.json", {
  defaultData: emptyPresenceState(),
});

export function readPresence(): PresenceState {
  try {
    const data = presenceStore.read();
    if (data && typeof data === "object") {
      return {
        live: data.live ?? {},
        tombstones: data.tombstones ?? {},
        seenIds: Array.isArray(data.seenIds) ? data.seenIds : [],
        pendingRetracts: Array.isArray(data.pendingRetracts) ? data.pendingRetracts : [],
      };
    }
  } catch {
    // Corrupt state falls back to empty; gossip rebuilds it.
  }
  return emptyPresenceState();
}

export function writePresence(state: PresenceState): void {
  presenceStore.write(state);
}

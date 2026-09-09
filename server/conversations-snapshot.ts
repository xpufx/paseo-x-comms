import { PluginStorage } from "paseo-plugin-helper/server";
import {
  emptyConversationsSnapshot,
  type XCommsConversationsSnapshot,
  type XCommsThreadSnapshot,
} from "../shared/conversations-snapshot.ts";
import { parseEnvelope } from "../shared/envelope.ts";

/**
 * Conversations snapshot writer (mesh visibility input). Daemon-local view
 * of active x-comms threads, maintained without timeline polling by
 * readers: writers update on send and on timeline reconcile (receive),
 * readers consume the file. Plain data in, plain data out.
 */

export const CONVERSATIONS_SNAPSHOT_FILE = "conversations.json";
export const CONVERSATIONS_THREAD_CAP = 200;

export interface SendRecord {
  peerAlias: string;
  peerServerId: string;
  peerAgentId: string;
  peerAgentName: string | null;
  localAgentId: string | null;
  at: string;
}

export interface TimelineEntryLike {
  item?: { type?: string; text?: string } | null;
}

export interface TimelineOwnerLike {
  ownerAgentId: string;
  entries: TimelineEntryLike[];
}

/**
 * Minimal structural surface needed to scan local timelines. The real
 * PaseoApi satisfies this; mocks in tests do too.
 */
export interface TimelineScanner {
  agents: {
    list(): Promise<{ entries: Array<{ agent: { id: string } }> }>;
    ref(id: string): {
      timeline: { refetch(): Promise<{ entries: Array<unknown> }> };
    };
  };
}

function asTimelineEntry(raw: unknown): TimelineEntryLike | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = (raw as { item?: unknown }).item;
  if (typeof item !== "object" || item === null) return null;
  const { type, text } = item as { type?: unknown; text?: unknown };
  return {
    item: {
      type: typeof type === "string" ? type : undefined,
      text: typeof text === "string" ? text : undefined,
    },
  };
}

/**
 * Pull every local agent's timeline and keep entries that carry the
 * x-comms envelope. Per-agent failures are skipped, never fatal.
 */
export async function scanLocalTimelines(scanner: TimelineScanner): Promise<TimelineOwnerLike[]> {
  const listed = await scanner.agents.list();
  const out: TimelineOwnerLike[] = [];
  for (const { agent } of listed.entries) {
    try {
      const page = await scanner.agents.ref(agent.id).timeline.refetch();
      const entries: TimelineEntryLike[] = [];
      for (const raw of page.entries) {
        const entry = asTimelineEntry(raw);
        if (entry) entries.push(entry);
      }
      out.push({ ownerAgentId: agent.id, entries });
    } catch {
      continue;
    }
  }
  return out;
}

function threadKey(peerServerId: string, peerAgentId: string): string {
  return `${peerServerId}/${peerAgentId}`;
}

function withLocalAgentIds(existing: string[], agentId: string | null): string[] {
  if (!agentId || existing.includes(agentId)) return existing;
  return [...existing, agentId];
}

/**
 * Record an outbound send. Sending implies caught-up: unread resets and the
 * read watermark advances to now.
 */
export function recordSend(
  snapshot: XCommsConversationsSnapshot,
  send: SendRecord,
): XCommsConversationsSnapshot {
  const key = threadKey(send.peerServerId, send.peerAgentId);
  const threads = snapshot.threads.filter((t) => threadKey(t.peerServerId, t.peerAgentId) !== key);
  threads.push({
    peerAlias: send.peerAlias,
    peerServerId: send.peerServerId,
    peerAgentId: send.peerAgentId,
    peerAgentName: send.peerAgentName,
    localAgentIds: withLocalAgentIds(
      snapshot.threads.find((t) => threadKey(t.peerServerId, t.peerAgentId) === key)?.localAgentIds ?? [],
      send.localAgentId,
    ),
    lastDirection: "outgoing",
    lastTimestamp: send.at,
    lastReadAt: send.at,
    lastSeenAt: send.at,
    unreadCount: 0,
  });
  return capThreads({ ...snapshot, threads, updatedAt: send.at });
}

/**
 * Reconcile inbound envelopes found in local agents' timelines. Only
 * messages newer than the thread's read watermark increment unread, so
 * rescans never double-count.
 */
export function reconcileTimelines(
  snapshot: XCommsConversationsSnapshot,
  timelines: TimelineOwnerLike[],
  peerAliasFor: (serverId: string) => string | null,
  nowIso: string = new Date().toISOString(),
): XCommsConversationsSnapshot {
  let threads = [...snapshot.threads];
  const upsert = (entry: Omit<XCommsThreadSnapshot, "localAgentIds" | "lastReadAt" | "lastSeenAt" | "unreadCount"> & {
    localAgentId: string;
  }) => {
    const key = threadKey(entry.peerServerId, entry.peerAgentId);
    const existing = threads.find((t) => threadKey(t.peerServerId, t.peerAgentId) === key);
    if (!existing) {
      threads.push({
        ...entry,
        localAgentIds: [entry.localAgentId],
        lastReadAt: new Date(0).toISOString(),
        lastSeenAt: entry.lastTimestamp,
        unreadCount: 1,
      });
      return;
    }
    const fresh = entry.lastTimestamp > existing.lastReadAt && entry.lastTimestamp > existing.lastSeenAt;
    const seenAt = entry.lastTimestamp > existing.lastSeenAt ? entry.lastTimestamp : existing.lastSeenAt;
    threads = threads.map((t) =>
      threadKey(t.peerServerId, t.peerAgentId) === key
        ? {
            ...t,
            peerAlias: entry.peerAlias,
            peerAgentName: entry.peerAgentName ?? t.peerAgentName,
            localAgentIds: withLocalAgentIds(t.localAgentIds, entry.localAgentId),
            lastDirection: "incoming",
            lastTimestamp: entry.lastTimestamp > t.lastTimestamp ? entry.lastTimestamp : t.lastTimestamp,
            lastSeenAt: seenAt,
            unreadCount: fresh ? t.unreadCount + 1 : t.unreadCount,
          }
        : t,
    );
  };
  for (const timeline of timelines) {
    for (const entry of timeline.entries) {
      const text = entry.item?.text;
      if (!text) continue;
      const parsed = parseEnvelope(text);
      if (!parsed) continue;
      const sender = parsed.envelope.xComms.sender;
      if (!sender.agentId || !sender.daemonServerId) continue;
      upsert({
        peerAlias: peerAliasFor(sender.daemonServerId) ?? sender.host ?? "unknown",
        peerServerId: sender.daemonServerId,
        peerAgentId: sender.agentId,
        peerAgentName: sender.agentName,
        localAgentId: timeline.ownerAgentId,
        lastDirection: "incoming",
        lastTimestamp: parsed.envelope.xComms.sentAt,
      });
    }
  }
  return capThreads({ ...snapshot, threads, updatedAt: nowIso });
}

/**
 * Drop threads for a peer agent that retracted (or whose link died).
 * Returns true when anything was removed.
 */
export function prunePeer(
  snapshot: XCommsConversationsSnapshot,
  peerServerId: string,
  peerAgentId: string,
): { snapshot: XCommsConversationsSnapshot; removed: boolean } {
  const key = threadKey(peerServerId, peerAgentId);
  const threads = snapshot.threads.filter((t) => threadKey(t.peerServerId, t.peerAgentId) !== key);
  return { snapshot: { ...snapshot, threads }, removed: threads.length !== snapshot.threads.length };
}

/**
 * Detach a local agent (archive): remove it from every thread's local
 * participants, dropping threads with nobody left.
 */
export function detachLocalAgent(
  snapshot: XCommsConversationsSnapshot,
  localAgentId: string,
): { snapshot: XCommsConversationsSnapshot; removed: boolean } {
  const threads = snapshot.threads
    .map((t) => ({ ...t, localAgentIds: t.localAgentIds.filter((id) => id !== localAgentId) }))
    .filter((t) => t.localAgentIds.length > 0);
  return { snapshot: { ...snapshot, threads }, removed: threads.length !== snapshot.threads.length };
}

function capThreads(snapshot: XCommsConversationsSnapshot): XCommsConversationsSnapshot {
  if (snapshot.threads.length <= CONVERSATIONS_THREAD_CAP) return snapshot;
  const threads = [...snapshot.threads]
    .sort((a, b) => (a.lastTimestamp < b.lastTimestamp ? 1 : -1))
    .slice(0, CONVERSATIONS_THREAD_CAP);
  return { ...snapshot, threads };
}

const conversationsStore = new PluginStorage<XCommsConversationsSnapshot>(
  "paseo-x-comms",
  CONVERSATIONS_SNAPSHOT_FILE,
  { defaultData: emptyConversationsSnapshot() },
);

export function conversationsSnapshotPath(): string {
  return conversationsStore.filePath;
}

export function readConversationsSnapshot(): XCommsConversationsSnapshot {
  try {
    const data = conversationsStore.read();
    if (data && typeof data === "object" && Array.isArray((data as { threads?: unknown }).threads)) {
      return data as XCommsConversationsSnapshot;
    }
  } catch {
    // Corrupt state falls back to empty; writers rebuild it.
  }
  return emptyConversationsSnapshot();
}

export function writeConversationsSnapshot(snapshot: XCommsConversationsSnapshot): void {
  conversationsStore.write(snapshot);
}

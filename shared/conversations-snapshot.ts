import { z } from "zod";

/**
 * Shared conversations snapshot for cross-plugin readers (top, mcp-tools).
 * Plain data only: no SDK types, so any consumer parses it with plain JSON.
 *
 * Writers: the x-comms plugin server updates it on every send and on every
 * timeline reconcile (receives), and prunes on retract/archive. Readers
 * never probe and never touch timelines; they read the file and render.
 */

export const CONVERSATIONS_SNAPSHOT_VERSION = 1 as const;

export const XCommsThreadSnapshotSchema = z.object({
  peerAlias: z.string(),
  peerServerId: z.string(),
  peerAgentId: z.string(),
  peerAgentName: z.string().nullable(),
  localAgentIds: z.array(z.string()),
  lastDirection: z.enum(["incoming", "outgoing"]),
  lastTimestamp: z.string(),
  lastReadAt: z.string(),
  lastSeenAt: z.string(),
  unreadCount: z.number().int().nonnegative(),
});

export type XCommsThreadSnapshot = z.infer<typeof XCommsThreadSnapshotSchema>;

export const XCommsConversationsSnapshotSchema = z.object({
  version: z.literal(CONVERSATIONS_SNAPSHOT_VERSION),
  updatedAt: z.string(),
  threads: z.array(XCommsThreadSnapshotSchema),
});

export type XCommsConversationsSnapshot = z.infer<typeof XCommsConversationsSnapshotSchema>;

export function emptyConversationsSnapshot(): XCommsConversationsSnapshot {
  return { version: CONVERSATIONS_SNAPSHOT_VERSION, updatedAt: new Date(0).toISOString(), threads: [] };
}

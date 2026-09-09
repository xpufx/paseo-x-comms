import { z } from "zod";

/**
 * The x-comms wire envelope: a `[x-comms] ` prefixed JSON block stamped on
 * every cross-daemon message. Pure parsing with no UI imports so the
 * conversation derive and its tests run anywhere.
 */

export const META_PREFIX = "[x-comms] ";

export const EnvelopeSchema = z.object({
  xComms: z.object({
    version: z.number(),
    type: z.string(),
    direction: z.enum(["incoming", "outgoing"]).optional(),
    sender: z.object({
      agentId: z.string().nullable(),
      agentName: z.string().nullable(),
      host: z.string().nullable(),
      daemonServerId: z.string().nullable(),
      cwd: z.string().nullable(),
    }),
    target: z.object({
      daemon: z.string().nullable(),
      agentId: z.string().nullable(),
    }),
    sentAt: z.string(),
  }),
});

export type CrossDaemonEnvelope = z.infer<typeof EnvelopeSchema>;

export type MessageDirection = "incoming" | "outgoing";

/**
 * Viewer-relative direction. The wire envelope stamps direction "outgoing"
 * from the sender's side, so only a message from self counts as user-sent.
 */
export function viewerDirection(env: CrossDaemonEnvelope, viewerAgentId: string): MessageDirection {
  const senderId = env.xComms.sender.agentId;
  return senderId !== null && senderId === viewerAgentId ? "outgoing" : "incoming";
}

export interface CardSignal {
  direction: MessageDirection;
  userSent: boolean;
}

/**
 * Pure card signal: red is reserved for user-sent messages only. Peer and
 * agent arrivals render neutral. Never derive red from envelope defaults.
 */
export function cardSignal(env: CrossDaemonEnvelope, viewerAgentId: string): CardSignal {
  const direction = viewerDirection(env, viewerAgentId);
  return { direction, userSent: direction === "outgoing" };
}

/**
 * Splits a message body into its x-comms envelope (if present) and the
 * remaining human-visible text. The envelope is a prefix our server stamps on
 * every x-comms message; its mere presence is the signal we render on.
 */
export function parseEnvelope(text: string): { envelope: CrossDaemonEnvelope; body: string } | null {
  if (!text.startsWith(META_PREFIX)) return null;
  const rest = text.slice(META_PREFIX.length).trimStart();
  const sep = rest.indexOf("\n\n");
  const json = sep === -1 ? rest : rest.slice(0, sep);
  const body = sep === -1 ? "" : rest.slice(sep + 2).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { envelope: parsed.data, body };
}

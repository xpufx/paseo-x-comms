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

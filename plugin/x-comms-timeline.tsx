import { z } from "zod";
import { Icon, type PluginTimelineItemProps, type PluginTimelineTransformerContribution, type PluginTimelineRendererContribution } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";

const META_PREFIX = "[x-comms] ";
const META_PREFIX_V2 = "[paseo-cross-daemon-comms meta v2] ";

const EnvelopeSchema = z.object({
  xComms: z.object({
    version: z.number(),
    type: z.string(),
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

const EnvelopeSchemaV2 = z.object({
  paseoCrossDaemonComms: z.object({
    version: z.number(),
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
type CrossDaemonEnvelopeV2 = z.infer<typeof EnvelopeSchemaV2>;
export type AnyEnvelope = CrossDaemonEnvelope | { xComms: CrossDaemonEnvelopeV2["paseoCrossDaemonComms"] };

function normalizeEnvelope(raw: unknown): CrossDaemonEnvelope | null {
  const v3 = EnvelopeSchema.safeParse(raw);
  if (v3.success) return v3.data;
  const v2 = EnvelopeSchemaV2.safeParse(raw);
  if (v2.success) return { xComms: v2.data.paseoCrossDaemonComms } as CrossDaemonEnvelope;
  if (raw && typeof raw === "object" && "paseoCrossDaemonComms" in (raw as Record<string, unknown>)) {
    const p = (raw as Record<string, unknown>).paseoCrossDaemonComms as Record<string, unknown>;
    const sender = (p.sender ?? {}) as Record<string, unknown>;
    const target = (p.target ?? {}) as Record<string, unknown>;
    return {
      xComms: {
        version: typeof p.version === "number" ? p.version : 2,
        type: "x-comms.incoming_message",
        sender: {
          agentId: (sender.agentId as string) ?? null,
          agentName: (sender.agentName as string) ?? null,
          host: (sender.host as string) ?? null,
          daemonServerId: (sender.daemonServerId as string) ?? null,
          cwd: (sender.cwd as string) ?? null,
        },
        target: {
          daemon: (target.daemon as string) ?? null,
          agentId: (target.agentId as string) ?? null,
        },
        sentAt: (p.sentAt as string) ?? new Date().toISOString(),
      },
    };
  }
  return null;
}

/**
 * Splits a message body into its x-comms envelope (if present) and the
 * remaining human-visible text. The envelope is a prefix our server stamps on
 * every x-comms message; its mere presence is the signal we render on.
 */
export function parseEnvelope(text: string): { envelope: CrossDaemonEnvelope; body: string } | null {
  let prefixLen = -1;
  if (text.startsWith(META_PREFIX)) prefixLen = META_PREFIX.length;
  else if (text.startsWith(META_PREFIX_V2)) prefixLen = META_PREFIX_V2.length;
  else return null;
  const rest = text.slice(prefixLen).trimStart();
  const sep = rest.indexOf("\n\n");
  const json = sep === -1 ? rest : rest.slice(0, sep);
  const body = sep === -1 ? "" : rest.slice(sep + 2).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const env = normalizeEnvelope(raw);
  if (!env) return null;
  return { envelope: env, body };
}

const ItemSchema = z.object({
  envelope: EnvelopeSchema,
  body: z.string(),
});

function senderLabel(env: CrossDaemonEnvelope): string {
  const s = env.xComms.sender;
  const name = s.agentName ?? s.agentId ?? "unknown agent";
  const daemon = s.daemonServerId ?? s.host ?? "remote";
  return `${name} @ ${daemon}`;
}

function CrossDaemonMessage({ theme, item }: PluginTimelineItemProps<z.infer<typeof ItemSchema>>) {
  const label = useMemo(() => senderLabel(item.data.envelope), [item.data.envelope]);
  return (
    <View style={{ paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <Icon name="PhoneOutgoing" size={14} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const }}>
          x-comms · {label}
        </Text>
      </View>
      {item.data.body.length > 0 ? (
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{item.data.body}</Text>
      ) : null}
    </View>
  );
}

/**
 * Timeline transformer: paseo calls this for every user_message. If the text
 * carries our meta envelope, we emit a plugin-typed item our renderer draws
 * distinctly. The envelope is the only discriminator.
 */
export const crossDaemonTransformer: PluginTimelineTransformerContribution<"user_message"> = {
  id: "x-comms-message",
  query: { itemType: "user_message" },
  transform({ item }) {
    const parsed = parseEnvelope(item.text);
    if (!parsed) return undefined;
    return {
      items: [
        {
          type: "plugin",
          kind: "x-comms-message",
          version: 1,
          data: { envelope: parsed.envelope, body: parsed.body },
        },
      ],
    };
  },
};

export const crossDaemonRenderer: PluginTimelineRendererContribution<typeof ItemSchema> = {
  kind: "x-comms-message",
  version: 1,
  schema: ItemSchema,
  Component: CrossDaemonMessage,
};

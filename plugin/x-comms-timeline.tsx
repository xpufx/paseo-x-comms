import { z } from "zod";
import { Icon, type PluginTimelineItemProps, type PluginTimelineTransformerContribution, type PluginTimelineRendererContribution } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";

const META_PREFIX = "[x-comms] ";

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

export type CrossDaemonEnvelope = z.infer<typeof EnvelopeSchema>;

/**
 * Splits a message body into its x-comms envelope (if present) and the
 * remaining human-visible text. The envelope is a prefix our server stamps on
 * every x-comms message; its mere presence is the signal we render on.
 */
export function parseEnvelope(text: string): { envelope: CrossDaemonEnvelope; body: string } | null {
  if (!text.startsWith(META_PREFIX)) return null;
  const rest = text.slice(META_PREFIX.length).trimStart();
  // The server stamps `<prefix> <json>\n\n<body>`: the envelope JSON is
  // single-line, then a blank line separates it from the human-visible text.
  // Split on the first blank line so JSON.parse only sees the envelope.
  const sep = rest.indexOf("\n\n");
  const json = sep === -1 ? rest : rest.slice(0, sep);
  const body = sep === -1 ? "" : rest.slice(sep + 2).trim();
  const parsed = EnvelopeSchema.safeParse(JSON.parse(json));
  if (!parsed.success) return null;
  return { envelope: parsed.data, body };
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

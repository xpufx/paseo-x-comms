import { z } from "zod";
import { type PluginTimelineItemProps, type PluginTimelineTransformerContribution, type PluginTimelineRendererContribution } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { EnvelopeSchema, cardSignal, parseEnvelope, type CrossDaemonEnvelope } from "./envelope";
import { formatPeerDisplay, usePeerAlias } from "./peer-label";
import { ViaXComms } from "./via-x-comms";

export { parseEnvelope, type CrossDaemonEnvelope };

const ItemSchema = z.object({
  envelope: EnvelopeSchema,
  body: z.string(),
});

function senderLabel(env: CrossDaemonEnvelope, alias: string | null): string {
  const s = env.xComms.sender;
  const name = s.agentName ?? s.agentId ?? "unknown agent";
  return `${name} @ ${formatPeerDisplay(alias, s.daemonServerId)}`;
}

function CrossDaemonMessage({ theme, agentId, item }: PluginTimelineItemProps<z.infer<typeof ItemSchema>>) {
  const alias = usePeerAlias(item.data.envelope.xComms.sender.daemonServerId);
  const label = useMemo(
    () => senderLabel(item.data.envelope, alias),
    [item.data.envelope, alias],
  );
  const { direction, userSent } = cardSignal(item.data.envelope, agentId);
  const incoming = direction === "incoming";
  const signalColor = userSent ? theme.colors.statusDanger : theme.colors.foregroundMuted;
  return (
    <View style={{ paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <Icon
          name={incoming ? "PhoneIncoming" : "PhoneOutgoing"}
          size={14}
          color={signalColor}
        />
        <Text style={{ color: signalColor, fontSize: 12, fontWeight: "600" as const }}>
          x-comms · {incoming ? "Incoming" : "Outgoing"} · {label}
        </Text>
      </View>
      {item.data.body.length > 0 ? (
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{item.data.body}</Text>
      ) : null}
      <ViaXComms theme={theme} />
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

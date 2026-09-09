import { z } from "zod";
import { type PluginTimelineItemProps, type PluginTimelineTransformerContribution, type PluginTimelineRendererContribution } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { EnvelopeSchema, cardSignal, isOverflowing, parseEnvelope, type CrossDaemonEnvelope } from "./envelope";
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

function MessageBody({ theme, body }: { theme: PluginTheme; body: string }) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const onTextLayout = useCallback(
    (e: { nativeEvent: { lines: unknown[] } }) => {
      const next = isOverflowing(e.nativeEvent.lines.length);
      setOverflows((prev) => (prev === next ? prev : next));
    },
    [],
  );
  const copy = useCallback(() => {
    copyText(body).then(
      () => toast.show("Copied", { variant: "success" }),
      () => toast.error("Copy failed"),
    );
  }, [body, toast]);
  if (!expanded) {
    return (
      <View>
        <Text
          style={{ color: theme.colors.foreground, fontSize: 13 }}
          numberOfLines={3}
          ellipsizeMode="tail"
          onTextLayout={onTextLayout}
        >
          {body}
        </Text>
        {overflows ? (
          <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} hitSlop={8}>
            <Text style={{ color: theme.colors.accent, fontSize: 12, marginTop: 2 }}>Show more</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 6,
        padding: 8,
        marginTop: 2,
        flexDirection: "row",
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 13, flexShrink: 1, flexGrow: 1 }} selectable>
        {body}
      </Text>
      <View style={{ flexDirection: "column", gap: 8, marginLeft: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Copy message" onPress={copy} hitSlop={10}>
          <Text style={{ color: theme.colors.accent, fontSize: 14 }}>⧉</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setExpanded(false)} hitSlop={8}>
          <Text style={{ color: theme.colors.accent, fontSize: 12 }}>Less</Text>
        </Pressable>
      </View>
    </View>
  );
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
        <MessageBody theme={theme} body={item.data.body} />
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

import { type PluginAgentPanelProps, usePaseo, useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { conversationSendRpc } from "./registry.shared";
import { deriveConversations, type ConversationPartner } from "./conversations";

export function CrossDaemonPanel({ theme, agentId }: PluginAgentPanelProps) {
  const paseo = usePaseo();
  const callSend = useRpc(conversationSendRpc);
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<ConversationPartner | null>(null);

  const conversations = useQuery({
    queryKey: ["cross-daemon-conversations", agentId],
    queryFn: () => deriveConversations(paseo, agentId),
  });

  const send = useMutation({
    mutationFn: () =>
      callSend({
        daemon: target?.counterparty.daemonServerId ?? target?.counterparty.daemon ?? "",
        agentId: target?.counterparty.agentId ?? "",
        prompt: draft,
      }),
    onSuccess: () => setDraft(""),
  });

  const pickTarget = useCallback((c: ConversationPartner) => setTarget(c), []);

  return (
    <View style={{ padding: 12, flex: 1 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, marginBottom: 8 }}>
        Cross-daemon conversations for this agent
      </Text>
      {conversations.isLoading ? (
        <ActivityIndicator />
      ) : conversations.data && conversations.data.length > 0 ? (
        <ScrollView style={{ marginBottom: 12 }}>
          {conversations.data.map((c) => (
            <Pressable
              key={c.conversationId}
              onPress={() => pickTarget(c)}
              style={({ pressed }) => [
                {
                  padding: 10,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: target?.conversationId === c.conversationId ? theme.colors.accent : theme.colors.border,
                  marginBottom: 6,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const }}>
                {c.counterparty.agentName ?? c.counterparty.agentId ?? "unknown"}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {c.counterparty.daemonServerId ?? c.counterparty.daemon ?? "?"} · {c.messageCount} msgs
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, marginBottom: 12 }}>
          No cross-daemon conversations detected.
        </Text>
      )}

      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Message the selected counterparty…"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 6,
          padding: 10,
          color: theme.colors.foreground,
          fontSize: 13,
          marginBottom: 8,
        }}
        multiline
      />
      <Pressable
        disabled={!target || !draft.trim() || send.isPending}
        onPress={() => send.mutate()}
        style={({ pressed }) => [
          { padding: 10, borderRadius: 6, borderWidth: 1.5, borderColor: theme.colors.accent, alignSelf: "flex-start" as const, minHeight: 44, justifyContent: "center" as const },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={{ color: theme.colors.accent, fontWeight: "600" as const }}>
          {send.isPending ? "Sending…" : "Send"}
        </Text>
      </Pressable>
      {send.error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12, marginTop: 6 }}>{String(send.error)}</Text> : null}
      {send.data && !send.data.ok ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 12, marginTop: 6 }}>{send.data.error}</Text>
      ) : null}
    </View>
  );
}

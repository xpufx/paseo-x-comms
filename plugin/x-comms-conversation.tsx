import { usePaseo, useRpc, type PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { conversationSendRpc, introspectAgentsRpc } from "./registry.shared";
import { deriveConversations, type ConversationPartner } from "./conversations";

export function CrossDaemonConversation({
  theme,
  agentId,
  onSent,
}: {
  theme: PluginTheme;
  agentId: string;
  onSent?: () => void;
}) {
  const paseo = usePaseo();
  const callSend = useRpc(conversationSendRpc);
  const callIntrospect = useRpc(introspectAgentsRpc);
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<ConversationPartner | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const conversations = useQuery({
    queryKey: ["x-comms-conversations", agentId],
    queryFn: () => deriveConversations(paseo, agentId),
  });
  const introspect = useQuery({
    queryKey: ["x-comms-introspect"],
    queryFn: () => callIntrospect({}),
    staleTime: 30000,
  });

  const send = useMutation({
    mutationFn: () =>
      callSend({
        daemon: target?.counterparty.daemonServerId ?? target?.counterparty.daemon ?? "",
        agentId: target?.counterparty.agentId ?? "",
        prompt: draft,
        fromAgentId: agentId,
        fromAgentName: undefined,
      }),
    onSuccess: () => {
      setDraft("");
      onSent?.();
    },
  });

  const pickTarget = useCallback((c: ConversationPartner) => setTarget(c), []);
  const pickPeer = useCallback((daemon: string, a: { agentId: string; shortId: string; name: string }) => {
    setTarget({
      conversationId: `${daemon}/${a.agentId}`,
      counterparty: { daemon, agentId: a.agentId, agentName: a.name, daemonServerId: null },
      lastActivity: new Date().toISOString(),
      messageCount: 0,
    });
    setPickerOpen(false);
  }, []);

  return (
    <View style={{ padding: 12, flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>X-comms conversations</Text>
        <Pressable onPress={() => setPickerOpen(true)} style={({ pressed }) => [{ padding: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.accent }, pressed && { opacity: 0.7 }]}>
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const }}>New</Text>
        </Pressable>
      </View>
      {conversations.isLoading ? (
        <ActivityIndicator />
      ) : conversations.data && conversations.data.length > 0 ? (
        <ScrollView style={{ marginBottom: 12, maxHeight: 160 }}>
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
                {c.counterparty.daemon ?? c.counterparty.daemonServerId ?? "?"} · {c.messageCount} msgs
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, marginBottom: 8 }}>
          No x-comms conversations yet — pick a peer to start.
        </Text>
      )}
      {target ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 8 }}>
          To: {target.counterparty.agentName ?? target.counterparty.agentId} on {target.counterparty.daemon ?? target.counterparty.daemonServerId}
        </Text>
      ) : null}

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
      <Modal title="New conversation" open={pickerOpen} onOpenChange={setPickerOpen}>
        <Modal.Content>
          {introspect.isPending ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>Loading agents…</Text> : null}
          {introspect.error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{String(introspect.error)}</Text> : null}
          <ScrollView style={{ maxHeight: 420 }}>
            {(introspect.data?.daemons ?? []).map((daemon) => (
              <View key={daemon.name}>
                <Text style={{ color: daemon.reachable ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 12, fontWeight: "700" as const, marginTop: 10, textTransform: "uppercase" as const }}>
                  {daemon.reachable ? daemon.name : `${daemon.name} (unreachable)`}
                </Text>
                {daemon.projects.map((project) => (
                  <View key={`${daemon.name}-${project.project}`}>
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, marginTop: 6, paddingLeft: 10 }}>{project.project}</Text>
                    {project.workspaces.map((ws) => (
                      <View key={`${daemon.name}-${project.project}-${ws.name}`}>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4, paddingLeft: 20 }}>⌂ {ws.name}</Text>
                        {ws.agents.map((a) => (
                          <Pressable key={a.agentId} onPress={() => pickPeer(daemon.name, a)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingLeft: 30 }, pressed && { opacity: 0.7 }]}>
                            <Text style={{ color: theme.colors.foreground, fontSize: 13, flexShrink: 1 }}>{a.name} ({a.shortId}) · {a.status}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </Modal.Content>
      </Modal>
    </View>
  );
}

import { usePaseo, useRpc, type PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Clipboard, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { conversationSendRpc, introspectAgentsRpc } from "./registry.shared";
import { deriveConversationThreads, deriveConversations, type ConversationMessage, type ConversationPartner, type ConversationThread } from "./conversations";

const draftCache = new Map<string, string>();
const targetCache = new Map<string, ConversationPartner | null>();
const sentCache = new Map<string, Map<string, ConversationMessage[]>>();

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
  const [draft, setDraft] = useState(() => draftCache.get(agentId) ?? "");
  const [target, setTarget] = useState<ConversationPartner | null>(() => targetCache.get(agentId) ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const queryClient = useQueryClient();
  const threads = useQuery({
    queryKey: ["x-comms-threads", agentId],
    queryFn: () => deriveConversationThreads(paseo, agentId),
    refetchOnMount: "always",
  });
  const conversations = useQuery({
    queryKey: ["x-comms-conversations", agentId],
    queryFn: () => deriveConversations(paseo, agentId),
    refetchOnMount: "always",
  });
  useEffect(() => {
    const unsub = paseo.agents.subscribe((update) => {
      if (update.kind === "upsert" && update.agent.id === agentId) {
        void queryClient.invalidateQueries({ queryKey: ["x-comms-conversations", agentId] });
        void queryClient.invalidateQueries({ queryKey: ["x-comms-threads", agentId] });
      }
    });
    return unsub;
  }, [paseo, agentId, queryClient]);
  const introspect = useQuery({
    queryKey: ["x-comms-introspect"],
    queryFn: () => callIntrospect({}),
    staleTime: 30000,
  });

  const [lastSent, setLastSent] = useState<{ at: string; to: string } | null>(null);
  const [sentTick, setSentTick] = useState(0);
  const send = useMutation({
    mutationFn: () =>
      callSend({
        daemon: target?.counterparty.daemonServerId ?? target?.counterparty.daemon ?? "",
        agentId: target?.counterparty.agentId ?? "",
        prompt: draft,
        fromAgentId: agentId,
        fromAgentName: "User",
      }),
    onSuccess: (data) => {
      if (data.ok && target) {
        const now = new Date().toISOString();
        const msg: ConversationMessage = {
          id: `sent-${now}-${Math.random().toString(36).slice(2, 6)}`,
          body: draft,
          sentAt: now,
          isIncoming: false,
          senderName: "You",
          daemon: target.counterparty.daemon ?? target.counterparty.daemonServerId,
        };
        const byAgent = sentCache.get(agentId) ?? new Map<string, ConversationMessage[]>();
        const list = byAgent.get(target.conversationId) ?? [];
        byAgent.set(target.conversationId, [...list, msg]);
        sentCache.set(agentId, byAgent);
        setSentTick((x) => x + 1);
        setLastSent({ at: new Date().toLocaleTimeString(), to: `${target.counterparty.agentName ?? target.counterparty.agentId} @ ${target.counterparty.daemon ?? target.counterparty.daemonServerId}` });
        setDraftCached("");
        void queryClient.invalidateQueries({ queryKey: ["x-comms-conversations", agentId] });
        void queryClient.invalidateQueries({ queryKey: ["x-comms-threads", agentId] });
      }
      onSent?.();
    },
  });

  const setDraftCached = useCallback((v: string) => {
    draftCache.set(agentId, v);
    setDraft(v);
  }, [agentId]);
  const setTargetCached = useCallback((c: ConversationPartner | null) => {
    targetCache.set(agentId, c);
    setTarget(c);
  }, [agentId]);
  const pickTarget = useCallback((c: ConversationPartner) => setTargetCached(c), [setTargetCached]);
  const pickPeer = useCallback((daemon: string, a: { agentId: string; shortId: string; name: string }) => {
    setTargetCached({
      conversationId: `${daemon}/${a.agentId}`,
      counterparty: { daemon, agentId: a.agentId, agentName: a.name, daemonServerId: null },
      lastActivity: new Date().toISOString(),
      messageCount: 0,
    });
    setPickerOpen(false);
  }, [setTargetCached]);

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
      {target ? (
        (() => {
          const thread = threads.data?.find((t: ConversationThread) => t.partner.conversationId === target.conversationId);
          const sent = sentCache.get(agentId)?.get(target.conversationId) ?? [];
          const incoming = thread?.messages ?? [];
          const all = [...incoming, ...sent].sort((a, b) => (a.sentAt < b.sentAt ? -1 : 1));
          if (all.length === 0) return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 8, fontStyle: "italic" as const }}>No messages yet — send the first.</Text>;
          return (
            <ScrollView style={{ maxHeight: 180, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, padding: 6 }}>
              {all.map((m) => (
                <View key={m.id} style={{ marginBottom: 6, alignSelf: m.isIncoming ? "flex-start" as const : "flex-end" as const, maxWidth: "85%", backgroundColor: m.isIncoming ? theme.colors.surface1 : theme.colors.accent + "20", borderRadius: 6, padding: 6, borderWidth: 1, borderColor: m.isIncoming ? theme.colors.border : theme.colors.accent }}>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{m.isIncoming ? m.senderName : "You"} · {new Date(m.sentAt).toLocaleTimeString()}</Text>
                  <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{m.body}</Text>
                </View>
              ))}
            </ScrollView>
          );
        })()
      ) : null}

      <TextInput
        value={draft}
        onChangeText={setDraftCached}
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
      {send.isSuccess && send.data?.ok ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
          <Text style={{ color: theme.colors.statusSuccess, fontSize: 12, flexShrink: 1 }}>
            ✓ Sent to {lastSent?.to ?? target?.counterparty.agentName ?? target?.counterparty.agentId} at {lastSent?.at ?? ""}
          </Text>
          <Pressable
            onPress={() => {
              setLastSent(null);
              send.reset();
            }}
            hitSlop={10}
          >
            <Text style={{ color: theme.colors.accent, fontSize: 12, paddingHorizontal: 6 }}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}
      {send.error ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
          <Text style={{ color: theme.colors.statusDanger, fontSize: 12, flexShrink: 1 }}>{String(send.error)}</Text>
          <Pressable onPress={() => void Clipboard.setString(String(send.error))} hitSlop={10}>
            <Text style={{ color: theme.colors.accent, fontSize: 16, paddingHorizontal: 6 }}>⧉</Text>
          </Pressable>
        </View>
      ) : null}
      {send.data && !send.data.ok ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
          <Text style={{ color: theme.colors.statusDanger, fontSize: 12, flexShrink: 1 }}>{send.data.error}</Text>
          <Pressable onPress={() => void Clipboard.setString(String(send.data?.error ?? ""))} hitSlop={10}>
            <Text style={{ color: theme.colors.accent, fontSize: 16, paddingHorizontal: 6 }}>⧉</Text>
          </Pressable>
        </View>
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

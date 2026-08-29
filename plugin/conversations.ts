import { usePaseo } from "@getpaseo/plugin";
import { parseEnvelope, type CrossDaemonEnvelope } from "./x-comms-timeline";

type PaseoApi = ReturnType<typeof usePaseo>;

export interface ConversationPartner {
  conversationId: string;
  // The counterparty this agent is talking to, derived from the envelope.
  counterparty: {
    daemon: string | null;
    agentId: string | null;
    agentName: string | null;
    daemonServerId: string | null;
  };
  lastActivity: string;
  messageCount: number;
}

/**
 * Derives the x-comms conversations an agent is part of by scanning its
 * timeline for our meta envelopes. No separate ledger file: the timeline is the
 * source of truth, so the result is never stale. Grouped by conversationId.
 */
export async function deriveConversations(
  paseo: PaseoApi,
  agentId: string,
): Promise<ConversationPartner[]> {
  const handle = paseo.agents.ref(agentId);
  const timeline = await handle.timeline.refetch();
  const byConversation = new Map<string, ConversationPartner>();
  for (const entry of timeline.entries) {
    const item = entry.item as { type?: string; text?: string };
    const text = item?.text;
    if (!text || (item.type !== "user_message" && item.type !== "assistant_message")) continue;
    const parsed = parseEnvelope(text);
    if (!parsed) continue;
    const env: CrossDaemonEnvelope = parsed.envelope;
    const meta = env.xComms;
    // The envelope carries the peer's serverId; the registry (and therefore the
    // send tool) is keyed by daemon *name*. We key the conversation by serverId
    // here and let the server-side send handler resolve serverId -> name, so the
    // client bundle never touches the server-only identity store.
    const daemon = meta.sender.daemonServerId ?? meta.sender.host ?? null;
    const id = `${daemon ?? "?"}/${meta.sender.agentId ?? "?"}`;
    const existing = byConversation.get(id);
    if (existing) {
      existing.messageCount += 1;
      if (meta.sentAt > existing.lastActivity) existing.lastActivity = meta.sentAt;
    } else {
      byConversation.set(id, {
        conversationId: id,
        counterparty: {
          daemon,
          agentId: meta.sender.agentId ?? null,
          agentName: meta.sender.agentName ?? null,
          daemonServerId: meta.sender.daemonServerId ?? null,
        },
        lastActivity: meta.sentAt,
        messageCount: 1,
      });
    }
  }
  return [...byConversation.values()].sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
}

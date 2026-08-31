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

export interface ConversationMessage {
  id: string;
  body: string;
  sentAt: string;
  isIncoming: boolean;
  senderName: string | null;
  daemon: string | null;
}

export interface ConversationThread {
  partner: ConversationPartner;
  messages: ConversationMessage[];
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
  const threads = await deriveConversationThreads(paseo, agentId);
  return threads.map((t) => t.partner);
}

export async function deriveConversationThreads(
  paseo: PaseoApi,
  agentId: string,
): Promise<ConversationThread[]> {
  const handle = paseo.agents.ref(agentId);
  const timeline = await handle.timeline.refetch();
  const byConversation = new Map<string, ConversationThread>();
  for (const entry of timeline.entries) {
    const item = entry.item as { type?: string; text?: string };
    const text = item?.text;
    if (!text || (item.type !== "user_message" && item.type !== "assistant_message")) continue;
    const parsed = parseEnvelope(text);
    if (!parsed) continue;
    const env: CrossDaemonEnvelope = parsed.envelope;
    const meta = env.xComms;
    const daemon = meta.sender.daemonServerId ?? meta.sender.host ?? null;
    const id = `${daemon ?? "?"}/${meta.sender.agentId ?? "?"}`;
    let thread = byConversation.get(id);
    if (!thread) {
      thread = {
        partner: {
          conversationId: id,
          counterparty: {
            daemon,
            agentId: meta.sender.agentId ?? null,
            agentName: meta.sender.agentName ?? null,
            daemonServerId: meta.sender.daemonServerId ?? null,
          },
          lastActivity: meta.sentAt,
          messageCount: 0,
        },
        messages: [],
      };
      byConversation.set(id, thread);
    }
    thread.messages.push({
      id: `${id}-${meta.sentAt}-${thread.messages.length}`,
      body: parsed.body,
      sentAt: meta.sentAt,
      isIncoming: true,
      senderName: meta.sender.agentName ?? meta.sender.agentId ?? "peer",
      daemon,
    });
    thread.partner.messageCount += 1;
    if (meta.sentAt > thread.partner.lastActivity) thread.partner.lastActivity = meta.sentAt;
  }
  for (const thread of byConversation.values()) thread.messages.sort((a, b) => (a.sentAt < b.sentAt ? -1 : 1));
  return [...byConversation.values()].sort((a, b) => (a.partner.lastActivity < b.partner.lastActivity ? 1 : -1));
}

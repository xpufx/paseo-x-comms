import { usePaseo } from "@getpaseo/plugin/client";
import { parseEnvelope, viewerDirection, type CrossDaemonEnvelope } from "../shared/envelope.ts";
import { isXCommsTool } from "./tool-call.ts";

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
  userSent?: boolean;
}

export interface ConversationThread {
  partner: ConversationPartner;
  messages: ConversationMessage[];
}

/**
 * Single shared thread key. Derive and the peer picker must agree, or the
 * merge site compares different strings and one side silently drops. The
 * server id wins when present; the alias or host is the fallback.
 */
export function threadKeyForCounterparty(cp: {
  daemon: string | null;
  daemonServerId: string | null;
  agentId: string | null;
}): string {
  return `${cp.daemonServerId ?? cp.daemon ?? "?"}/${cp.agentId ?? "?"}`;
}

/**
 * Match two counterparties across alias vs serverId discrepancies.
 */
export function isCounterpartyMatch(
  a: { daemon: string | null; daemonServerId?: string | null; agentId: string | null },
  b: { daemon: string | null; daemonServerId?: string | null; agentId: string | null },
): boolean {
  if (!a.agentId || !b.agentId || a.agentId !== b.agentId) return false;
  const aServer = a.daemonServerId ?? (a.daemon?.startsWith("srv_") ? a.daemon : null);
  const bServer = b.daemonServerId ?? (b.daemon?.startsWith("srv_") ? b.daemon : null);
  if (aServer && bServer) {
    return aServer === bServer;
  }
  if (!aServer && !bServer && a.daemon && b.daemon) {
    return a.daemon === b.daemon;
  }
  return true;
}

/**
 * Interleave both directions by timestamp and deduplicate optimistic vs recorded sends.
 */
export function mergeMessages(
  incoming: ConversationMessage[],
  sent: ConversationMessage[],
): ConversationMessage[] {
  const seenIds = new Set<string>();
  const out: ConversationMessage[] = [];
  for (const m of [...incoming, ...sent]) {
    if (seenIds.has(m.id)) continue;
    const isDup = out.some(
      (existing) =>
        existing.body === m.body &&
        existing.isIncoming === m.isIncoming &&
        Math.abs(new Date(existing.sentAt).getTime() - new Date(m.sentAt).getTime()) < 3000,
    );
    if (!isDup) {
      seenIds.add(m.id);
      out.push(m);
    }
  }
  return out.sort((a, b) => (a.sentAt < b.sentAt ? -1 : 1));
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

  function addMessage(
    counterparty: { daemon: string | null; agentId: string | null; agentName: string | null; daemonServerId: string | null },
    msgData: Omit<ConversationMessage, "id"> & { id?: string },
  ) {
    const id = threadKeyForCounterparty(counterparty);
    let thread = byConversation.get(id);
    if (!thread) {
      for (const t of byConversation.values()) {
        if (isCounterpartyMatch(t.partner.counterparty, counterparty)) {
          thread = t;
          break;
        }
      }
    }
    if (!thread) {
      thread = {
        partner: {
          conversationId: id,
          counterparty,
          lastActivity: msgData.sentAt,
          messageCount: 0,
        },
        messages: [],
      };
      byConversation.set(id, thread);
    }
    const msgId = msgData.id ?? `${thread.partner.conversationId}-${msgData.sentAt}-${thread.messages.length}`;
    thread.messages.push({ ...msgData, id: msgId });
    thread.partner.messageCount += 1;
    if (msgData.sentAt > thread.partner.lastActivity) {
      thread.partner.lastActivity = msgData.sentAt;
    }
  }

  for (const entry of timeline.entries) {
    const item = entry.item as { type?: string; text?: string; name?: string; detail?: unknown } | undefined;
    if (!item) continue;

    // Case 1: user_message or assistant_message carrying [x-comms] wire envelope
    if (item.type === "user_message" || item.type === "assistant_message") {
      const text = item.text;
      if (!text) continue;
      const parsed = parseEnvelope(text);
      if (!parsed) continue;
      const env: CrossDaemonEnvelope = parsed.envelope;
      const meta = env.xComms;
      const isIncoming = viewerDirection(env, agentId) === "incoming";
      const daemon = isIncoming
        ? (meta.sender.daemonServerId ?? meta.sender.host ?? null)
        : (meta.target.daemon ?? null);
      const counterparty = isIncoming
        ? {
            daemon,
            agentId: meta.sender.agentId ?? null,
            agentName: meta.sender.agentName ?? null,
            daemonServerId: meta.sender.daemonServerId ?? null,
          }
        : {
            daemon,
            agentId: meta.target.agentId ?? null,
            agentName: null,
            daemonServerId: daemon && daemon.startsWith("srv_") ? daemon : null,
          };
      const senderName = isIncoming
        ? (meta.sender.agentName ?? meta.sender.agentId ?? "peer")
        : "You";
      addMessage(counterparty, {
        body: parsed.body,
        sentAt: meta.sentAt,
        isIncoming,
        senderName,
        daemon,
        userSent: !isIncoming,
      });
      continue;
    }

    // Case 2: tool_call invoking x_comms_send
    if (item.type === "tool_call" || (item.name && isXCommsTool(item.name))) {
      const name = item.name ?? "";
      if (isXCommsTool(name) && name.includes("send")) {
        const detail = item.detail as { input?: Record<string, unknown> } | undefined;
        const input = detail && typeof detail === "object" ? detail.input : undefined;
        if (input && typeof input === "object") {
          const targetDaemon = typeof input.daemon === "string" ? input.daemon : null;
          const targetAgentId = typeof input.agentId === "string" ? input.agentId : null;
          const prompt = typeof input.prompt === "string" ? input.prompt : "";
          if (targetAgentId) {
            const daemonServerId = targetDaemon && targetDaemon.startsWith("srv_") ? targetDaemon : null;
            const counterparty = {
              daemon: targetDaemon,
              agentId: targetAgentId,
              agentName: null,
              daemonServerId,
            };
            const sentAt = (entry as { timestamp?: string }).timestamp ?? new Date().toISOString();
            const fromUser = input.fromAgentName === "User" || !input.fromAgentId || input.fromAgentId === agentId;
            addMessage(counterparty, {
              id: `tool-send-${targetAgentId}-${sentAt}-${prompt.slice(0, 8)}`,
              body: prompt,
              sentAt,
              isIncoming: false,
              senderName: fromUser ? "You" : (typeof input.fromAgentName === "string" ? input.fromAgentName : "Agent"),
              daemon: targetDaemon,
              userSent: fromUser,
            });
          }
        }
      }
    }
  }

  for (const thread of byConversation.values()) {
    thread.messages.sort((a, b) => (a.sentAt < b.sentAt ? -1 : 1));
  }
  return [...byConversation.values()].sort((a, b) => (a.partner.lastActivity < b.partner.lastActivity ? 1 : -1));
}

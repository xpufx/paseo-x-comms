import type { PaseoAgentListResult, PaseoAgentUpdate } from "@getpaseo/client";
import { Icon, type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/react-native";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { CrossDaemonConversation } from "./cross-daemon-conversation";

function CrossDaemonPill(props: PluginComposerPillProps) {
  const { theme } = props;
  const style = useMemo(
    () => ({ color: theme.colors.accent, flexShrink: 1 }),
    [theme],
  );
  return (
    <>
      <Icon name="PhoneOutgoing" size={14} color={theme.colors.accent} />
      <Text numberOfLines={1} style={style}>
        Cross-daemon
      </Text>
    </>
  );
}

// Bridge between the per-agent composer pills (which can only drive local
// state on tap) and the Modal each pill renders when it is the open one.
// Module-scoped so onPress and the open check share one source of truth, with
// a subscription set so mounted pills re-render when the open agent changes.
let openAgentId: string | null = null;
const listeners = new Set<() => void>();
function setOpenAgentId(next: string | null): void {
  openAgentId = next;
  listeners.forEach((notify) => notify());
}
export function openCrossDaemonForAgent(agentId: string): void {
  setOpenAgentId(agentId);
}

/**
 * One composer pill per agent, opening that agent's cross-daemon conversation
 * in a paseo Modal over the composer (not a panel/tab navigation). Pills are
 * seeded from the agent list and follow the agent update stream so they appear
 * and disappear as agents come and go. The Modal is rendered by the pill whose
 * agentId is open; addClientSide cannot mount an overlay, so the pill Component
 * is the Modal host.
 */
export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, () => void>();

  function addPill(agentId: string, workspaceId: string) {
    if (pills.has(agentId)) return;
    pills.set(
      agentId,
      client.addComposerPill({
        id: "cross-daemon",
        title: "Cross-daemon",
        workspaceId,
        agentId,
        Component: ({ theme }) => {
          const [isOpen, setIsOpen] = useState(openAgentId === agentId);
          useEffect(() => {
            const notify = () => setIsOpen(openAgentId === agentId);
            listeners.add(notify);
            notify();
            return () => {
              listeners.delete(notify);
            };
          }, [agentId]);
          return (
            <>
              <CrossDaemonPill {...{ theme, agentId, workspaceId, host: undefined as never, layout: undefined as never }} />
              <Modal
                title="Cross-daemon"
                icon={<Icon name="PhoneOutgoing" />}
                open={isOpen}
                onOpenChange={(open: boolean) => {
                  if (!open) setOpenAgentId(null);
                }}
              >
                <Modal.Content>
                  <CrossDaemonConversation theme={theme} agentId={agentId} />
                </Modal.Content>
              </Modal>
            </>
          );
        },
        onPress() {
          openCrossDaemonForAgent(agentId);
        },
      }),
    );
  }

  function removePill(agentId: string) {
    pills.get(agentId)?.();
    pills.delete(agentId);
  }

  const unsubscribe = client.paseo.agents.subscribe((update: PaseoAgentUpdate) => {
    if (update.kind === "remove") {
      removePill(update.agentId);
      return;
    }
    const { id, workspaceId } = update.agent;
    if (workspaceId) addPill(id, workspaceId);
  });

  client.paseo.agents
    .list()
    .then((result: PaseoAgentListResult) => {
      result.entries.forEach(({ agent }) => {
        if (agent.workspaceId) addPill(agent.id, agent.workspaceId);
      });
    })
    .catch((error: unknown) => {
      console.error("cross-daemon: could not seed composer pills", error);
    });

  return () => {
    unsubscribe();
    pills.forEach((remove) => remove());
    pills.clear();
    setOpenAgentId(null);
  };
}

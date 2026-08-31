import type { PaseoAgentListResult, PaseoAgentUpdate } from "@getpaseo/client";
import { Icon, type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/react-native";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { CrossDaemonConversation } from "./x-comms-conversation";
import { agentPromptGetRpc, agentPromptSetRpc } from "./registry.shared";

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
        X-comms
      </Text>
    </>
  );
}

/**
 * One composer pill per agent. Tapping the pill opens that agent's x-comms
 * conversation in a Modal anchored to (and hosted by) the pill's own component
 * tree, via local state — so it opens connected to the pill and closes with it.
 * Pills are seeded from the agent list and follow the agent update stream so they
 * appear and disappear as agents come and go.
 */
export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, () => void>();

  function addPill(agentId: string, workspaceId: string) {
    if (pills.has(agentId)) return;
    let setOpen: ((open: boolean) => void) | null = null;
    const remove = client.addComposerPill({
      id: "x-comms",
      title: "X-comms",
      workspaceId,
      agentId,
      Component: ({ theme }) => {
        const [isOpen, setIsOpen] = useState(false);
        setOpen = setIsOpen;
        return (
          <>
            <CrossDaemonPill {...{ theme, agentId, workspaceId, host: undefined as never, layout: undefined as never }} />
            <Modal
              title="X-comms"
              icon={<Icon name="PhoneOutgoing" />}
              open={isOpen}
              onOpenChange={(open: boolean) => {
                if (!open) setIsOpen(false);
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
        setOpen?.(true);
      },
    });
    pills.set(agentId, remove);
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
      console.error("x-comms: could not seed composer pills", error);
    });

  // Auto-patch the prompt on first install: if the daemon has no
  // x-comms block, add it once. Keeps fresh GitHub clones from needing
  // a manual Main → Add block click. Runs once per app load, idempotent.
  void client
    .rpc(agentPromptGetRpc, {})
    .then((res) => {
      if (!res.hasBlock) return client.rpc(agentPromptSetRpc, { enabled: true });
    })
    .catch(() => {});

  return () => {
    unsubscribe();
    pills.forEach((remove) => remove());
    pills.clear();
  };
}

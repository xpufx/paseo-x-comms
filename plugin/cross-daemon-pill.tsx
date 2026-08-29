import type { PaseoAgentListResult, PaseoAgentUpdate } from "@getpaseo/client";
import { Icon, type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text } from "react-native";

function CrossDaemonPill({ theme }: PluginComposerPillProps) {
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

/**
 * One composer pill per agent, opening that agent's cross-daemon panel. Mirrors
 * the skills plugin's client-side pill registration: seed from existing agents
 * and follow the agents update stream so pills appear as agents come and go.
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
        Component: CrossDaemonPill,
        onPress() {
          client.openPanel("cross-daemon", { workspaceId, agentId });
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
  };
}

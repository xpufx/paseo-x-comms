import type { PaseoAgentListResult, PaseoAgentUpdate } from "@getpaseo/client";
import { Icon, type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";

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
 * One composer pill per agent, opening that agent's x-comms conversation in the
 * registered agent panel (id "x-comms") via openPanel. A pill-anchored Modal
 * is the ideal UX, but @getpaseo/plugin/react-native (Modal) is not importable
 * from plugin client code until the in-app-surface PR ships in a released
 * @getpaseo/plugin; openPanel is the supported path today.
 */
export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, () => void>();

  function addPill(agentId: string, workspaceId: string) {
    if (pills.has(agentId)) return;
    pills.set(
      agentId,
      client.addComposerPill({
        id: "x-comms",
        title: "X-comms",
        workspaceId,
        agentId,
        Component: ({ theme }) => (
          <CrossDaemonPill {...{ theme, agentId, workspaceId, host: undefined as never, layout: undefined as never }} />
        ),
        onPress() {
          client.openPanel("x-comms", { workspaceId, agentId });
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
      console.error("x-comms: could not seed composer pills", error);
    });

  return () => {
    unsubscribe();
    pills.forEach((remove) => remove());
    pills.clear();
  };
}

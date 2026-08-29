import { type PluginAgentPanelProps } from "@getpaseo/plugin";
import { CrossDaemonConversation } from "./x-comms-conversation";

export function CrossDaemonPanel({ theme, agentId }: PluginAgentPanelProps) {
  return <CrossDaemonConversation theme={theme} agentId={agentId} />;
}

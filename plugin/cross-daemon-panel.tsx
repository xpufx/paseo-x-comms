import { type PluginAgentPanelProps } from "@getpaseo/plugin";
import { CrossDaemonConversation } from "./cross-daemon-conversation";

export function CrossDaemonPanel({ theme, agentId }: PluginAgentPanelProps) {
  return <CrossDaemonConversation theme={theme} agentId={agentId} />;
}

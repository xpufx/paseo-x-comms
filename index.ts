import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface } from "./plugin/main.client";
import { crossDaemonTransformer, crossDaemonRenderer } from "./plugin/cross-daemon-timeline";
import { contributeClient } from "./plugin/cross-daemon-pill";
import { CrossDaemonPanel } from "./plugin/cross-daemon-panel";
import {
  handleRegistryRead,
  handleDaemonAdd,
  handleDaemonUpdate,
  handleDaemonRemove,
  handleDaemonHealth,
  handleServerStatus,
  handleServerCheck,
  handleServerLocate,
  handleServerSetPath,
  handleConversationSend,
  handleIntrospectAgents,
  handleIntroduceAgents,
  handleDaemonProbe,
  handleUiPrefsGet,
  handleUiPrefsSet,
  handleSnapshotRefresh,
  handleDaemonDump,
  handleIdentitySync,
} from "./plugin/handlers.server";
import {
  registryReadRpc,
  daemonAddRpc,
  daemonUpdateRpc,
  daemonRemoveRpc,
  daemonHealthRpc,
  serverStatusRpc,
  serverCheckRpc,
  serverLocateRpc,
  serverSetPathRpc,
  conversationSendRpc,
  introspectAgentsRpc,
  introduceAgentsRpc,
  daemonProbeRpc,
  uiPrefsGetRpc,
  uiPrefsSetRpc,
  snapshotRefreshRpc,
  daemonDumpRpc,
  identitySyncRpc,
} from "./plugin/registry.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(registryReadRpc, handleRegistryRead);
  plugin.handle(daemonAddRpc, handleDaemonAdd);
  plugin.handle(daemonUpdateRpc, handleDaemonUpdate);
  plugin.handle(daemonRemoveRpc, handleDaemonRemove);
  plugin.handle(daemonHealthRpc, handleDaemonHealth);
  plugin.handle(serverStatusRpc, handleServerStatus);
  plugin.handle(serverCheckRpc, handleServerCheck);
  plugin.handle(serverLocateRpc, handleServerLocate);
  plugin.handle(serverSetPathRpc, handleServerSetPath);
  plugin.handle(conversationSendRpc, handleConversationSend);
  plugin.handle(introspectAgentsRpc, handleIntrospectAgents);
  plugin.handle(introduceAgentsRpc, handleIntroduceAgents);
  plugin.handle(daemonProbeRpc, handleDaemonProbe);
  plugin.handle(uiPrefsGetRpc, handleUiPrefsGet);
  plugin.handle(uiPrefsSetRpc, handleUiPrefsSet);
  plugin.handle(snapshotRefreshRpc, handleSnapshotRefresh);
  plugin.handle(daemonDumpRpc, handleDaemonDump);
  plugin.handle(identitySyncRpc, handleIdentitySync);
  plugin.addClientSide(contributeClient);
  plugin.addTimelineTransformer(crossDaemonTransformer);
  plugin.addTimelineRenderer(crossDaemonRenderer);
  plugin.addWorkspacePanel({
    id: "cross-daemon",
    title: "Cross-daemon",
    icon: "PhoneOutgoing",
    context: "agent",
    Component: CrossDaemonPanel,
  });
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: "Cross-daemon comms",
    icon: "PhoneOutgoing",
    surface: "main",
  });
  return () => {};
}

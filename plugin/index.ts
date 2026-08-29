import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface } from "./main.client";
import { crossDaemonTransformer, crossDaemonRenderer } from "./cross-daemon-timeline";
import { contributeClient } from "./cross-daemon-pill";
import { CrossDaemonPanel } from "./cross-daemon-panel";
import {
  handleRegistryRead,
  handleDaemonAdd,
  handleDaemonUpdate,
  handleDaemonRemove,
  handleDaemonHealth,
  handleServerStatus,
  handleServerInstall,
  handleServerUninstall,
  handleServerCheck,
  handleConversationSend,
  handleIntrospectAgents,
  handleIntroduceAgents,
  handleDaemonProbe,
  handleServerLocate,
  handleServerSetPath,
  handleUiPrefsGet,
  handleUiPrefsSet,
  handleSnapshotRefresh,
  handleDaemonDump,
  handleIdentitySync,
} from "./handlers.server";
import {
  registryReadRpc,
  daemonAddRpc,
  daemonUpdateRpc,
  daemonRemoveRpc,
  daemonHealthRpc,
  serverStatusRpc,
  serverInstallRpc,
  serverUninstallRpc,
  serverCheckRpc,
  conversationSendRpc,
  introspectAgentsRpc,
  introduceAgentsRpc,
  daemonProbeRpc,
  serverLocateRpc,
  serverSetPathRpc,
  uiPrefsGetRpc,
  uiPrefsSetRpc,
  snapshotRefreshRpc,
  daemonDumpRpc,
  identitySyncRpc,
} from "./registry.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(registryReadRpc, handleRegistryRead);
  plugin.handle(daemonAddRpc, handleDaemonAdd);
  plugin.handle(daemonUpdateRpc, handleDaemonUpdate);
  plugin.handle(daemonRemoveRpc, handleDaemonRemove);
  plugin.handle(daemonHealthRpc, handleDaemonHealth);
  plugin.handle(serverStatusRpc, handleServerStatus);
  plugin.handle(serverInstallRpc, handleServerInstall);
  plugin.handle(serverUninstallRpc, handleServerUninstall);
  plugin.handle(serverCheckRpc, handleServerCheck);
  plugin.handle(introspectAgentsRpc, handleIntrospectAgents);
  plugin.handle(introduceAgentsRpc, handleIntroduceAgents);
  plugin.handle(conversationSendRpc, handleConversationSend);
  plugin.handle(daemonProbeRpc, handleDaemonProbe);
  plugin.handle(serverLocateRpc, handleServerLocate);
  plugin.handle(serverSetPathRpc, handleServerSetPath);
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
    icon: "ArrowLeftRight",
    context: "agent",
    Component: CrossDaemonPanel,
  });
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: "Cross-daemon comms",
    icon: "Server",
    surface: "main",
  });
  return () => {};
}
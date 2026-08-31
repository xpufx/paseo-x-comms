import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface } from "./plugin/main.client";
import { crossDaemonTransformer, crossDaemonRenderer } from "./plugin/x-comms-timeline";
import { contributeClient } from "./plugin/x-comms-pill";
import { CrossDaemonPanel } from "./plugin/x-comms-panel";
import {
  handleRegistryRead,
  handleDaemonAdd,
  handleDaemonUpdate,
  handleDaemonRemove,
  handleDaemonHealth,
  handleServerStatus,
  handleServerCheck,
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
    id: "x-comms",
    title: "X-comms",
    icon: "PhoneOutgoing",
    context: "agent",
    Component: CrossDaemonPanel,
  });
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: "X-comms",
    icon: "PhoneOutgoing",
    surface: "main",
  });
  return () => {};
}

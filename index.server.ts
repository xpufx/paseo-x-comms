import type { PluginServerContext } from "@getpaseo/plugin/server";
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
} from "./server/handlers";
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
} from "./shared/registry";

export default function contribute(server: PluginServerContext) {
  server.handle(registryReadRpc, handleRegistryRead);
  server.handle(daemonAddRpc, handleDaemonAdd);
  server.handle(daemonUpdateRpc, handleDaemonUpdate);
  server.handle(daemonRemoveRpc, handleDaemonRemove);
  server.handle(daemonHealthRpc, handleDaemonHealth);
  server.handle(serverStatusRpc, handleServerStatus);
  server.handle(serverCheckRpc, handleServerCheck);
  server.handle(conversationSendRpc, handleConversationSend);
  server.handle(introspectAgentsRpc, handleIntrospectAgents);
  server.handle(introduceAgentsRpc, handleIntroduceAgents);
  server.handle(daemonProbeRpc, handleDaemonProbe);
  server.handle(uiPrefsGetRpc, handleUiPrefsGet);
  server.handle(uiPrefsSetRpc, handleUiPrefsSet);
  server.handle(snapshotRefreshRpc, handleSnapshotRefresh);
  server.handle(daemonDumpRpc, handleDaemonDump);
  server.handle(identitySyncRpc, handleIdentitySync);
  return () => {};
}

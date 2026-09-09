import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "paseo-plugin-helper/client";
import { MainSurface } from "./client/main";
import { crossDaemonTransformer, crossDaemonRenderer } from "./client/x-comms-timeline";
import { crossDaemonToolCallTransformer, crossDaemonToolCallRenderer } from "./client/x-comms-tool-call";
import { contributeClient } from "./client/x-comms-pill";
import { CrossDaemonPanel } from "./client/x-comms-panel";

initClientHelpers({ Icon, Modal, useRpc, useToast });

export default function contribute(client: PluginClientContext) {
  client.addTimelineTransformer(crossDaemonTransformer);
  client.addTimelineRenderer(crossDaemonRenderer);
  client.addTimelineTransformer(crossDaemonToolCallTransformer);
  client.addTimelineRenderer(crossDaemonToolCallRenderer);
  client.addWorkspacePanel({
    id: "x-comms",
    title: "X-comms",
    icon: "PhoneOutgoing",
    context: "agent",
    Component: CrossDaemonPanel,
  });
  client.addSurface("main", MainSurface);
  client.addSidebarItem({
    id: "main",
    title: "X-comms",
    icon: "PhoneOutgoing",
    surface: "main",
  });
  return contributeClient(client);
}

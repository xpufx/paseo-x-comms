import { type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { AboutSection, Tabs, registerComposerPill } from "paseo-plugin-helper/client";
import { useMemo, useState } from "react";
import { Text } from "react-native";
import { CrossDaemonConversation } from "./x-comms-conversation";

function CrossDaemonPill(props: PluginComposerPillProps) {
  const { theme } = props;
  const style = useMemo(
    () => ({ color: theme.colors.accent, flexShrink: 1, fontSize: 10 }),
    [theme],
  );
  return (
    <>
      <Icon name="PhoneOutgoing" size={9} color={theme.colors.accent} />
      <Text numberOfLines={1} style={style}>
        X-comms
      </Text>
    </>
  );
}

function XCommsModalContent({ theme, agentId }: { theme: PluginComposerPillProps["theme"]; agentId: string }) {
  const [tab, setTab] = useState("chat");
  return (
    <>
      <Tabs
        tabs={[
          { id: "chat", label: "Chat" },
          { id: "about", label: "About" },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />
      {tab === "about" ? (
        <AboutSection
          name="X-comms"
          description="Cross-daemon agent conversation over Paseo Relay."
          version="0.3.0"
          repository="https://github.com/xpufx/paseo-cross-daemon-comms.git"
          license="Apache-2.0"
        />
      ) : (
        <CrossDaemonConversation theme={theme} agentId={agentId} />
      )}
    </>
  );
}

/**
 * One composer pill per agent. Lifecycle (agent subscription, pill mount and
 * unmount, modal open state, theme) is managed by registerComposerPill; this
 * module only supplies the pill body and modal content.
 */
export function contributeClient(client: PluginClientContext) {
  return registerComposerPill(client, {
    id: "x-comms",
    title: "X-comms",
    icon: "PhoneOutgoing",
    modalTitle: "X-comms",
    renderPill: (props) => <CrossDaemonPill {...props} />,
    renderModal: (props) => <XCommsModalContent theme={props.theme} agentId={props.agentId} />,
  });
}

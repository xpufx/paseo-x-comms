import { useRpc, type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { AboutSection, Tabs, Toggle, registerComposerPill } from "paseo-plugin-helper/client";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { CrossDaemonConversation } from "./x-comms-conversation";
import { uiPrefsGetRpc, uiPrefsSetRpc } from "../shared/registry";

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

function XCommsSettings({ theme }: { theme: PluginComposerPillProps["theme"] }) {
  const callGet = useRpc(uiPrefsGetRpc);
  const callSet = useRpc(uiPrefsSetRpc);
  const [presence, setPresence] = useState<boolean | null>(null);
  const [injection, setInjection] = useState<boolean | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    callGet({})
      .then((prefs) => {
        if (!live) return;
        setPresence(prefs.presenceEnabled);
        setInjection(prefs.injectionEnabled);
        setCollapsed(prefs.prereqsCollapsed);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
    };
  }, [callGet]);
  const save = (next: { presenceEnabled: boolean; injectionEnabled: boolean }) => {
    setSaving(true);
    setError(null);
    callSet({ prereqsCollapsed: collapsed, ...next })
      .then((prefs) => {
        setPresence(prefs.presenceEnabled);
        setInjection(prefs.injectionEnabled);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSaving(false));
  };
  return (
    <View style={{ gap: 12, paddingVertical: 8 }}>
      {presence === null || injection === null ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Loading settings…</Text>
      ) : (
        <>
          <Toggle
            value={presence}
            onValueChange={(next) => {
              setPresence(next);
              save({ presenceEnabled: next, injectionEnabled: injection });
            }}
            label="Presence"
            description="Announce local agent births and retracts to paired daemons."
            disabled={saving}
          />
          <Toggle
            value={injection}
            onValueChange={(next) => {
              setInjection(next);
              save({ presenceEnabled: presence, injectionEnabled: next });
            }}
            label="MCP injection"
            description="Add the x-comms server to every newborn agent."
            disabled={saving}
          />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            Changes take effect after the plugin reloads.
          </Text>
        </>
      )}
      {error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}

function XCommsModalContent({ theme, agentId }: { theme: PluginComposerPillProps["theme"]; agentId: string }) {
  const [tab, setTab] = useState("chat");
  return (
    <>
      <Tabs
        tabs={[
          { id: "chat", label: "Chat" },
          { id: "settings", label: "Settings" },
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
      ) : tab === "settings" ? (
        <XCommsSettings theme={theme} />
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

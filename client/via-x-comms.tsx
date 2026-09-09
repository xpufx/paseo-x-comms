import { Text } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { XCOMMS_VIA_LABEL } from "./attribution";

/**
 * Tiny muted source footer for every shared-surface row this plugin
 * renders: timeline cards, panels, surfaces, modal content.
 */
export function ViaXComms({ theme }: { theme: PluginTheme }) {
  return (
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, textAlign: "right" as const }}>
      {XCOMMS_VIA_LABEL}
    </Text>
  );
}

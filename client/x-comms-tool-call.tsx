import { type PluginTimelineItemProps, type PluginTimelineTransformerContribution, type PluginTimelineRendererContribution } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Badge, Card, CodeBlock, StatusDot } from "paseo-plugin-helper/client";
import { Text, View } from "react-native";
import { ViaXComms } from "./via-x-comms";
import { usePeerDisplay } from "./peer-label";
import { ToolCallCardSchema, summarizeToolCall, type ToolCallCardData } from "./tool-call";

function statusVariant(status: string): "success" | "warning" | "danger" | "info" {
  if (status === "completed") return "success";
  if (status === "running") return "info";
  if (status === "failed" || status === "canceled") return "danger";
  return "warning";
}

function ToolCallCard({ theme, item }: PluginTimelineItemProps<ToolCallCardData>) {
  const data = item.data;
  const peer = usePeerDisplay(data.targetServerId, data.targetAlias);
  const title = data.agentId ? `${data.tool} · ${data.agentId.slice(0, 8)}` : data.tool;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <Icon name="PhoneOutgoing" size={13} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" as const, flexShrink: 1 }}>
          {title}
        </Text>
        <StatusDot variant={statusVariant(data.status)} size="sm" />
        <Badge label={data.status} variant={statusVariant(data.status)} />
      </View>
      {(data.targetAlias || data.targetServerId) ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 4 }} selectable>
          {peer}
        </Text>
      ) : null}
      {data.output ? (
        <CodeBlock code={data.output} language="json" copyable maxHeight={220} />
      ) : null}
      <ViaXComms theme={theme} />
    </Card>
  );
}

/**
 * Timeline transformer: matches tool_call items for x_comms_* tools and
 * replaces the raw JSON row with a card. Matching is a pure name-prefix
 * check with no visibility toggles: tool calls never render as JSON walls.
 */
export const crossDaemonToolCallTransformer: PluginTimelineTransformerContribution<"tool_call"> = {
  id: "x-comms-tool-call",
  query: { itemType: "tool_call" },
  transform({ item }) {
    const summary = summarizeToolCall({
      name: item.name,
      status: item.status,
      error: item.status === "failed" ? item.error : undefined,
      detail: item.detail,
    });
    if (!summary) return undefined;
    return {
      items: [
        {
          type: "plugin",
          kind: "x-comms-tool-call",
          version: 1,
          data: {
            tool: summary.tool,
            agentId: summary.agentId,
            targetAlias: summary.targetAlias,
            targetServerId: summary.targetServerId,
            status: summary.status,
            failed: summary.failed,
            output: summary.output,
          },
        },
      ],
    };
  },
};

export const crossDaemonToolCallRenderer: PluginTimelineRendererContribution<typeof ToolCallCardSchema> = {
  kind: "x-comms-tool-call",
  version: 1,
  schema: ToolCallCardSchema,
  Component: ToolCallCard,
};

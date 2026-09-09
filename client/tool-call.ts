import { z } from "zod";

/**
 * Tool names are `x_comms_*` as registered, but clients may surface them
 * under a registration-name prefix (e.g. `paseo_cross_daemon_send`), so
 * both shapes map to a card.
 */
const TOOL_NAME_RES = [/^x_comms_/, /(^|_)x_comms_/, /^paseo_cross_daemon_/];

export function isXCommsTool(name: string): boolean {
  return TOOL_NAME_RES.some((re) => re.test(name));
}

function shortTool(name: string): string {
  const inner = name.match(/(x_comms_\w+)$/);
  if (inner) return inner[1];
  const legacy = name.match(/^paseo_cross_daemon_(\w+)$/);
  if (legacy) return `x_comms_${legacy[1]}`;
  return name;
}

const UnknownDetailSchema = z.object({
  type: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});

export interface ToolCallSummary {
  tool: string;
  agentId: string | null;
  targetAlias: string | null;
  targetServerId: string | null;
  status: string;
  failed: boolean;
  output: string | null;
}

const OUTPUT_LIMIT = 2000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringifyOutput(output: unknown): string | null {
  if (output === undefined || output === null) return null;
  const text = typeof output === "string" ? output : JSON.stringify(output);
  if (text.length <= OUTPUT_LIMIT) return text;
  return `${text.slice(0, OUTPUT_LIMIT)}… [truncated ${text.length - OUTPUT_LIMIT} chars]`;
}

function pickTarget(input: unknown): { agentId: string | null; targetAlias: string | null; targetServerId: string | null } {
  const args = asRecord(input);
  if (!args) return { agentId: null, targetAlias: null, targetServerId: null };
  const daemon = typeof args.daemon === "string" ? args.daemon : null;
  const serverId = typeof args.serverId === "string" ? args.serverId : null;
  const agentId = typeof args.agentId === "string" ? args.agentId : null;
  return {
    agentId,
    targetAlias: daemon && !daemon.startsWith("srv_") ? daemon : null,
    targetServerId: serverId ?? (daemon?.startsWith("srv_") ? daemon : null),
  };
}

export interface ToolCallItemInput {
  name: string;
  status: string;
  error?: unknown;
  detail?: unknown;
}

export function summarizeToolCall(item: ToolCallItemInput): ToolCallSummary | null {
  if (!isXCommsTool(item.name)) return null;
  const detail = UnknownDetailSchema.safeParse(item.detail);
  const input = detail.success ? detail.data.input : undefined;
  const rawOutput = detail.success ? detail.data.output : undefined;
  const { agentId, targetAlias, targetServerId } = pickTarget(input);
  const failed = item.status === "failed" || item.status === "canceled";
  const errorText = item.status === "failed" && item.error !== undefined && item.error !== null
    ? (typeof item.error === "string" ? item.error : JSON.stringify(item.error))
    : null;
  if (!agentId && !targetAlias && !targetServerId && !errorText && stringifyOutput(rawOutput) === null) {
    return {
      tool: shortTool(item.name),
      agentId: null,
      targetAlias: null,
      targetServerId: null,
      status: item.status,
      failed,
      output: null,
    };
  }
  return {
    tool: shortTool(item.name),
    agentId,
    targetAlias,
    targetServerId,
    status: item.status,
    failed,
    output: errorText ?? stringifyOutput(rawOutput),
  };
}

export const ToolCallCardSchema = z.object({
  tool: z.string(),
  agentId: z.string().nullable(),
  targetAlias: z.string().nullable(),
  targetServerId: z.string().nullable(),
  status: z.string(),
  failed: z.boolean(),
  output: z.string().nullable(),
});

export type ToolCallCardData = z.infer<typeof ToolCallCardSchema>;

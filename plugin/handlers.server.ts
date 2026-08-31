import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { getSnapshotFresh, agentCountFor, refreshSnapshot, initializeSnapshot } from "./snapshot.server";
import {
  registryReadRpc,
  daemonAddRpc,
  daemonUpdateRpc,
  daemonRemoveRpc,
  daemonHealthRpc,
  serverCheckRpc,
  agentPromptGetRpc,
  agentPromptSetRpc,
} from "./registry.shared";
import {
  parseRegistry,
  validateDaemonHost,
  validateDaemonName,
  currentRegistryPath,
  readRegistry,
  mutateRegistry,
} from "./registry.server";
import { serverPath } from "./server-status.server";

// Startup check: validate whatever is already in the registry as soon as the
// plugin backend loads, so a corrupt or invalid config is caught early and
// visible in `paseo plugin logs`.
export function runStartupCheck(): void {
  const registryPath = currentRegistryPath();
  const current = readRegistry(registryPath);
  if (!current.exists) {
    console.log(`[registry] no registry at ${registryPath} (will be created on first save)`);
    return;
  }
  if (!current.ok) {
    console.error(`[registry] existing registry at ${registryPath} is corrupt: ${current.parseError}`);
    return;
  }
  const invalid = current.daemons.filter((daemon) => !daemon.valid);
  if (invalid.length > 0) {
    console.error(
      `[registry] ${invalid.length} invalid entr${invalid.length === 1 ? "y" : "ies"} at ${registryPath}: ${invalid
        .map((daemon) => `${daemon.name} (${daemon.error})`)
        .join(", ")}`,
    );
  } else {
    console.log(`[registry] ${current.daemons.length} daemon(s) at ${registryPath}, all valid`);
  }
}

// Runs when this module evaluates in the plugin subprocess.
runStartupCheck();
// Prime the fleet snapshot so daemon health, agent counts, and the Introduce
// pickers are ready immediately instead of fetching lazily on first request.
initializeSnapshot();

export function hostnameFor(daemon: string): string | null {
  const hostnames = readUiPrefs().daemonHostnames ?? {};
  return hostnames[daemon] ?? null;
}

// Marker delimiting the block we append to the daemon's appendSystemPrompt.
// Strip only removes our marked block so user-authored prompt text is preserved.
const PROMPT_BLOCK_START = "<!-- paseo-x-comms-system-prompt -->";
const PROMPT_BLOCK_END = "<!-- /paseo-x-comms-system-prompt -->";

function buildPromptBlock(daemons: Array<{ name: string; serverId: string | null }>): string {
  const lines =
    daemons.length > 0
      ? daemons.map((d) => `- ${d.name}${d.serverId ? ` (serverId ${d.serverId})` : ""}`).join("\n")
      : "(none — add daemons via the X-comms Main surface or x_comms_add_daemon)";
  return `${PROMPT_BLOCK_START}
[x-comms system] Cross-daemon messaging via MCP tools x_comms_* (embedded, registry ~/.paseo/paseo-x-comms/registry.json).
Reachable daemons:
${lines}

Envelope (prepended by x_comms_send): [x-comms] {"xComms":{"version":3,"type":"x-comms.incoming_message","sender":{"agentId","agentName","host","daemonServerId","cwd"},"target":{"daemon","agentId"},"sentAt":"ISO"}}
Inbound [x-comms] is from another agent, not a user. Parse sender and reply with x_comms_send(daemon=sender.daemon, agentId=sender.agentId, prompt="..."). On finish/error/permission-block, notify the sender the same way with details.

Tools: x_comms_list_daemons, x_comms_list_agents(daemon), x_comms_inspect(daemon, agentId), x_comms_logs(daemon, agentId), x_comms_send(daemon, agentId, prompt), x_comms_wait(daemon, agentId, timeoutSeconds?), x_comms_list_permissions(daemon), x_comms_allow_permission(daemon, agentId, reqId|all, input?), x_comms_deny_permission(daemon, agentId, reqId|all, message?, interrupt?)

Behavior: x_comms_send is preemptive (replaceRunning:true); if target may be busy, x_comms_wait first. x_comms_wait -> idle|permission|timeout; on permission: x_comms_list_permissions -> allow/deny -> wait again.
${PROMPT_BLOCK_END}`;
}

function stripPromptBlock(prompt: string): string {
  const re = new RegExp(
    `${PROMPT_BLOCK_START}[\\s\\S]*?${PROMPT_BLOCK_END}\\n?`,
    "g",
  );
  return prompt.replace(re, "").trim();
}

function hasPromptBlock(prompt: string): boolean {
  return prompt.includes(PROMPT_BLOCK_START);
}

type PaseoHandlerContext = { paseo: { config: { get: (requestId?: string) => Promise<{ config: Record<string, unknown> }>; patch: (patch: Record<string, unknown>, requestId?: string) => Promise<{ config: Record<string, unknown> }> } } };

export async function handleAgentPromptGet(_input: unknown, ctx: PaseoHandlerContext) {
  const res = await ctx.paseo.config.get();
  const prompt = (res?.config?.appendSystemPrompt as string) ?? "";
  return { appendSystemPrompt: prompt, hasBlock: hasPromptBlock(prompt) };
}

export async function handleAgentPromptSet(input: { enabled: boolean }, ctx: PaseoHandlerContext) {
  try {
    const current = ((await ctx.paseo.config.get())?.config?.appendSystemPrompt as string) ?? "";
    let next: string;
    if (input.enabled) {
      if (hasPromptBlock(current)) {
        next = current; // already present; leave as-is
      } else {
        const daemons = readRegistry(currentRegistryPath()).daemons.map((d) => ({ name: d.name, serverId: (d as any).serverId ?? null }));
        next = (current.trim().length > 0 ? current + "\n\n" : "") + buildPromptBlock(daemons);
      }
    } else {
      next = stripPromptBlock(current);
    }
    await ctx.paseo.config.patch({ appendSystemPrompt: next });
    return { appendSystemPrompt: next, hasBlock: hasPromptBlock(next), error: null };
  } catch (cause) {
    return {
      appendSystemPrompt: "",
      hasBlock: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function handleRegistryRead() {
  const registryPath = currentRegistryPath();
  const current = readRegistry(registryPath);
  const daemons = current.daemons.map((daemon) => ({
    ...daemon,
    serverId: identityFor(daemon.name),
    hostname: hostnameFor(daemon.name),
  }));
  return { registryPath, exists: current.exists, validJson: current.ok, parseError: current.parseError, daemons };
}

export async function handleDaemonAdd(input: { name: string; value: string }) {
  const registryPath = currentRegistryPath();
  const nameCheck = validateDaemonName(input.name);
  if (!nameCheck.valid) {
    return { saved: false, error: nameCheck.error, registryPath, daemons: readRegistry(registryPath).daemons };
  }
  const result = mutateRegistry(registryPath, (daemons) => {
    if (daemons[input.name] !== undefined) {
      throw new Error(`daemon '${input.name}' already exists`);
    }
    return { ...daemons, [input.name]: input.value };
  });
  if (result.saved) await refreshSnapshot();
  return result;
}

export async function handleDaemonUpdate(input: { name: string; rename?: string; value?: string }) {
  const registryPath = currentRegistryPath();
  const nameCheck = validateDaemonName(input.name);
  if (!nameCheck.valid) {
    return { saved: false, error: nameCheck.error, registryPath, daemons: readRegistry(registryPath).daemons };
  }
  const rename = input.rename?.trim();
  if (rename !== undefined) {
    const renameCheck = validateDaemonName(rename);
    if (!renameCheck.valid) {
      return { saved: false, error: renameCheck.error, registryPath, daemons: readRegistry(registryPath).daemons };
    }
  }
  const result = mutateRegistry(registryPath, (daemons) => {
    if (daemons[input.name] === undefined) {
      throw new Error(`daemon '${input.name}' does not exist`);
    }
    const target = rename && rename !== input.name ? rename : input.name;
    if (target !== input.name && daemons[target] !== undefined) {
      throw new Error(`daemon '${target}' already exists`);
    }
    const value = input.value?.trim() ?? daemons[input.name];
    const next = { ...daemons };
    delete next[input.name];
    return { ...next, [target]: value };
  });
  if (result.saved) await refreshSnapshot();
  return result;
}

export async function handleDaemonRemove(input: { name: string }) {
  const registryPath = currentRegistryPath();
  const nameCheck = validateDaemonName(input.name);
  if (!nameCheck.valid) {
    return { saved: false, error: nameCheck.error, registryPath, daemons: readRegistry(registryPath).daemons };
  }
  const result = mutateRegistry(registryPath, (daemons) => {
    if (daemons[input.name] === undefined) {
      throw new Error(`daemon '${input.name}' does not exist`);
    }
    const next = { ...daemons };
    delete next[input.name];
    return next;
  });
  if (result.saved) await refreshSnapshot();
  return result;
}

export async function handleDaemonHealth() {
  const snapshot = await getSnapshotFresh();
  return {
    results: snapshot.daemons.map((entry) => ({
      name: entry.name,
      reachable: entry.reachable,
      error: entry.error,
      agentCount: agentCountFor(entry),
    })),
  };
}

export async function handleIntrospectAgents() {
  const snapshot = await getSnapshotFresh();
  return {
    daemons: snapshot.daemons.map(({ name, reachable, error, projects }) => ({ name, reachable, error, projects })),
  };
}

import { McpStdioClient } from "./mcp-client.server";

// Sends go through the bundled paseo-x-comms server over stdio MCP,
// so every message carries the meta envelope (sender identity) stamped by the
// server itself. Each recipient gets the other party's address so a real
// two-way reply is possible, not just two one-way drops.
export async function handleIntroduceAgents(input: {
  first: { daemon: string; agentId: string; shortId: string; name: string };
  second: { daemon: string; agentId: string; shortId: string; name: string };
  message: string;
}) {
  let path: string;
  try {
    path = serverPath();
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return { sends: [{ daemon: input.first.daemon, agentId: input.first.agentId, ok: false, error: msg }, { daemon: input.second.daemon, agentId: input.second.agentId, ok: false, error: msg }] };
  }
  const firstLabel = `Agent ${input.first.shortId} (${input.first.name}) on daemon "${input.first.daemon}"`;
  const secondLabel = `Agent ${input.second.shortId} (${input.second.name}) on daemon "${input.second.daemon}"`;
  const firstMessage = `${input.message.trim()}\n\nYou have been introduced to ${secondLabel}. To reply, use x_comms_send with daemon="${input.second.daemon}" and agentId="${input.second.agentId}". Your messages will be delivered with a sender envelope the other agent can use to reply.`;
  const secondMessage = `${input.message.trim()}\n\nYou have been introduced to ${firstLabel}. To reply, use x_comms_send with daemon="${input.first.daemon}" and agentId="${input.first.agentId}". Your messages will be delivered with a sender envelope the other agent can use to reply.`;

  const client = new McpStdioClient(path);
  try {
    await client.connect();
    const targets = [
      { daemon: input.first.daemon, agentId: input.first.agentId, fromAgentId: input.first.agentId, fromAgentName: input.first.name, message: firstMessage },
      { daemon: input.second.daemon, agentId: input.second.agentId, fromAgentId: input.second.agentId, fromAgentName: input.second.name, message: secondMessage },
    ];
    const sends = await Promise.all(
      targets.map(async (target) => {
        try {
          await client.callTool("x_comms_send", {
            daemon: target.daemon,
            agentId: target.agentId,
            prompt: target.message,
            fromAgentId: target.fromAgentId ?? null,
            fromAgentName: target.fromAgentName ?? null,
          });
          return { daemon: target.daemon, agentId: target.agentId, ok: true, error: null };
        } catch (cause) {
          return {
            daemon: target.daemon,
            agentId: target.agentId,
            ok: false,
            error: cause instanceof Error ? cause.message : String(cause),
          };
        }
      }),
    );
    return { sends };
  } finally {
    client.close();
  }
}

export async function handleServerStatus() {
  try {
    const path = serverPath();
    const version = extractServerVersion(path);
    return { installPath: path, installed: true, configured: true, version, syntaxOk: true, error: null };
  } catch (cause) {
    return { installPath: "", installed: false, configured: false, version: null, syntaxOk: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

// The server version this plugin is built against, bumped in lockstep with the
// server release. Inlined (not in paseo-plugin.json, whose schema is strict)
// so the version check can flag a mismatch with whatever server is installed.
const EXPECTED_SERVER_VERSION = "0.3.0";

function expectedServerVersion(): string {
  return EXPECTED_SERVER_VERSION;
}

// Reports the version the bundled server carries and whether it matches the
// plugin's expected version. The server always ships with the plugin, so this
// is a passive sanity check, not a locate/install step.
export async function handleServerCheck() {
  try {
    const path = serverPath();
    const version = extractServerVersion(path);
    const expected = expectedServerVersion();
    return { path, located: true, version, expected, match: version !== null && version === expected, error: null };
  } catch (cause) {
    return { path: "", located: false, version: null, expected: expectedServerVersion(), match: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

// Sends a message to a specific agent on a daemon through the located server.
// Reuses the same located-server path every other RPC uses.
function extractServerVersion(serverPath: string): string | null {
  try {
    const source = readFileSync(serverPath, "utf8");
    const match = source.match(/const VERSION = "([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function handleConversationSend(input: { daemon: string; agentId: string; prompt: string; fromAgentId?: string | null; fromAgentName?: string | null }) {
  const sendDaemon = daemonNameForServerId(input.daemon) ?? input.daemon;
  let client: InstanceType<typeof McpStdioClient> | null = null;
  try {
    const path = serverPath();
    client = new McpStdioClient(path);
    await client.connect();
    await client.callTool("x_comms_send", {
      daemon: sendDaemon,
      agentId: input.agentId,
      prompt: input.prompt,
      fromAgentId: input.fromAgentId ?? null,
      fromAgentName: input.fromAgentName ?? null,
    });
    return { daemon: input.daemon, agentId: input.agentId, ok: true, error: null };
  } catch (cause) {
    return {
      daemon: input.daemon,
      agentId: input.agentId,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    client?.close();
  }
}


const PROBE_TIMEOUT_MS = 8000;

function runProbe(value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("paseo", ["ls", "--host", value, "--json"], { timeout: PROBE_TIMEOUT_MS }, (error, _stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve();
    });
  });
}

export async function handleDaemonProbe(input: { value: string }) {
  const format = validateDaemonHost(input.value);
  if (!format.valid) {
    return { valid: false, formatError: format.error, reachable: false, error: null };
  }
  try {
    await runProbe(input.value);
    return { valid: true, formatError: null, reachable: true, error: null };
  } catch (cause) {
    return {
      valid: true,
      formatError: null,
      reachable: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}



import { readFileSync as readPrefsFile, writeFileSync as writePrefsFile, existsSync as prefsExists, renameSync } from "node:fs";
import { stateDir, migrateFromRoot } from "./registry.server";

const UI_PREFS_FILE = join(stateDir(), "plugin.json");
migrateFromRoot("paseo-x-comms-plugin.json", UI_PREFS_FILE);

interface UiPrefsState {
  prereqsCollapsed?: boolean;
  daemonIdentities?: Record<string, string>;
  daemonHostnames?: Record<string, string>;
  serverPath?: string;
  serverPathSet?: boolean;
}

function readUiPrefs(): UiPrefsState {
  try {
    if (prefsExists(UI_PREFS_FILE)) {
      const parsed = JSON.parse(readPrefsFile(UI_PREFS_FILE, "utf8")) as UiPrefsState;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // corrupt prefs fall back to defaults; not fatal
  }
  return {};
}

export function identityFor(daemon: string): string | null {
  const identities = readUiPrefs().daemonIdentities ?? {};
  return identities[daemon] ?? null;
}

// The registry is keyed by daemon *name*, but x-comms envelopes carry the
// peer's serverId. identitySync stores name -> serverId, so invert it to map a
// sender's serverId back to the registered daemon name the send tool expects.
export function daemonNameForServerId(serverId: string | null): string | null {
  if (!serverId) return null;
  const identities = readUiPrefs().daemonIdentities ?? {};
  for (const [name, id] of Object.entries(identities)) {
    if (id === serverId) return name;
  }
  return null;
}

async function fetchPeerServerInfo(value: string): Promise<{ serverId: string; hostname: string | null } | null> {
  const offer = parseOffer(value);
  if (offer?.serverId) return { serverId: offer.serverId, hostname: null };
  return null;
}

/**
 * Fetch the real serverId from every registered daemon and store it in the
 * plugin state (name -> serverId). Keeps the registry untouched so the MCP
 * server's string-host contract is unaffected; identity is additive.
 */
export async function handleIdentitySync() {
  const daemons = readRegistry(currentRegistryPath()).daemons;
  const state = readUiPrefs();
  const identities: Record<string, string> = { ...(state.daemonIdentities ?? {}) };
  const hostnames: Record<string, string> = { ...(state.daemonHostnames ?? {}) };
  for (const daemon of daemons) {
    const info = await fetchPeerServerInfo(daemon.value);
    if (info?.serverId) identities[daemon.name] = info.serverId;
    if (info?.hostname) hostnames[daemon.name] = info.hostname;
  }
  writePrefsFile(UI_PREFS_FILE, JSON.stringify({ ...state, daemonIdentities: identities, daemonHostnames: hostnames }, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  return { identities, hostnames };
}

export async function handleUiPrefsGet() {
  return { prereqsCollapsed: readUiPrefs().prereqsCollapsed === true };
}

export async function handleUiPrefsSet(input: { prereqsCollapsed: boolean }) {
  const state = readUiPrefs();
  writePrefsFile(UI_PREFS_FILE, JSON.stringify({ ...state, prereqsCollapsed: input.prereqsCollapsed }, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  return { prereqsCollapsed: input.prereqsCollapsed };
}

export async function handleSnapshotRefresh() {
  const snapshot = await refreshSnapshot();
  return { updatedAt: snapshot.updatedAt };
}

async function runPaseoDumpJson(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("paseo", args, { timeout: 20000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim().slice(0, 200)));
      else {
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error("non-JSON output")); }
      }
    });
  });
}

function parseOffer(value: string): {
  serverId: string | null;
  daemonPublicKeyB64: string | null;
  relayEndpoint: string | null;
  useTls: boolean;
} | null {
  const m = value.match(/#offer=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const payload = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    return {
      serverId: typeof payload.serverId === "string" ? payload.serverId : null,
      daemonPublicKeyB64: typeof payload.daemonPublicKeyB64 === "string" ? payload.daemonPublicKeyB64 : null,
      relayEndpoint: typeof payload.relay?.endpoint === "string" ? payload.relay.endpoint : null,
      useTls: payload.relay?.useTls === true,
    };
  } catch {
    return null;
  }
}

function safe<T,>(raw: unknown, selector: (x: Record<string, unknown>) => T): T[] {
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]).map(selector) : [];
}
function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export async function handleDaemonDump(input: { daemon: string }) {
  const daemons = readRegistry(currentRegistryPath()).daemons;
  const entry = daemons.find((d) => d.name === input.daemon);
  if (!entry) {
    return { name: input.daemon, reached: false, error: `unknown daemon '${input.daemon}'`, serverId: null, hostname: null, version: null, desktopManaged: null, capabilities: null, features: null, listen: null, pid: null, nodePath: null, startedAt: null, relayEndpoints: null, relayEnabled: null, transport: null, agents: [], workspaces: [], projects: [], providers: [], providerCount: 0, permissions: [], schedules: [], terminals: [] };
  }
  const offer = parseOffer(entry!.value);
  const transport = offer ? "relay" : "direct";
  const hostValue = entry!.value;
  async function tryHost(args: string[]): Promise<unknown> {
    try {
      return await runPaseoDumpJson([...args, "--host", hostValue, "--json"]);
    } catch {
      return null;
    }
  }
  try {
    const [status, agentsRes, workspacesRes, projectsRes, schedRes, termRes] = await Promise.all([
      tryHost(["daemon", "status"]),
      tryHost(["ls", "--global"]),
      tryHost(["workspace", "ls"]),
      tryHost(["project", "ls"]),
      tryHost(["schedule", "ls"]),
      tryHost(["terminal", "ls"]),
    ]);
    const statusPayload = status && typeof status === "object" && (status as any).data ? (status as any).data : status;
    const resolvedPayload = statusPayload && typeof statusPayload === "object" ? (statusPayload as Record<string, unknown>) : null;
    const agentsRaw = Array.isArray(agentsRes) ? agentsRes : Array.isArray((agentsRes as any)?.data) ? (agentsRes as any).data : [];
    const workspacesRaw = Array.isArray(workspacesRes) ? workspacesRes : Array.isArray((workspacesRes as any)?.data) ? (workspacesRes as any).data : [];
    const projectsRaw = Array.isArray(projectsRes) ? projectsRes : Array.isArray((projectsRes as any)?.data) ? (projectsRes as any).data : Array.isArray((projectsRes as any)?.projects) ? (projectsRes as any).projects : [];
    const agentsEntries = (Array.isArray(agentsRaw) ? agentsRaw : []) as Record<string, unknown>[];
    const workspacesEntries = (Array.isArray(workspacesRaw) ? workspacesRaw : []) as Record<string, unknown>[];
    const projectsEntries = (Array.isArray(projectsRaw) ? projectsRaw : []) as Record<string, unknown>[];
    const schedEntries = Array.isArray((schedRes as any)?.schedules)
      ? ((schedRes as any)?.schedules ?? []) as Record<string, unknown>[]
      : Array.isArray((schedRes as any)?.data)
        ? ((schedRes as any).data as Record<string, unknown>[])
        : Array.isArray(schedRes) ? (schedRes as Record<string, unknown>[]) : [];
    const termEntries = Array.isArray((termRes as any)?.terminals)
      ? ((termRes as any)?.terminals ?? []) as Record<string, unknown>[]
      : Array.isArray((termRes as any)?.data)
        ? ((termRes as any).data as Record<string, unknown>[])
        : Array.isArray(termRes) ? (termRes as Record<string, unknown>[]) : [];
    const providersFromStatus = safe((resolvedPayload as any)?.providers ?? (status as any)?.providers ?? [], (p) => ({
      provider: str(p.provider),
      available: (p as any)?.available === true,
      error: (p as any)?.error ?? null,
    }));
    const serverId = str((resolvedPayload as any)?.serverId ?? offer?.serverId ?? "");
    const hostname = str((resolvedPayload as any)?.hostname ?? "");
    const version = str((resolvedPayload as any)?.daemonVersion ?? (resolvedPayload as any)?.version ?? "");
    const reached = status !== null || agentsRes !== null || workspacesRes !== null;
    if (!reached) throw new Error("all peer probes failed");
    return {
      name: input.daemon,
      reached: true,
      error: null,
      serverId,
      hostname,
      version,
      desktopManaged: (resolvedPayload as any)?.desktopManaged ?? null,
      capabilities: null,
      features: null,
      listen: str((resolvedPayload as any)?.listen ?? ""),
      pid: (resolvedPayload as any)?.pid ?? null,
      nodePath: str((resolvedPayload as any)?.daemonNode ?? (resolvedPayload as any)?.nodePath ?? ""),
      startedAt: str((resolvedPayload as any)?.startedAt ?? ""),
      relayEndpoints: (resolvedPayload as any)?.relay
        ? [str((resolvedPayload as any)?.relay?.endpoint ?? ""), str((resolvedPayload as any)?.relay?.publicEndpoint ?? "")]
        : null,
      relayEnabled: (resolvedPayload as any)?.relay?.enabled ?? null,
      transport,
      agents: agentsEntries.map((a) => {
        const agent = (a as any)?.agent ?? a;
        return {
          agentId: str(agent.id), shortId: str(agent.shortId), name: str(agent.name), status: str(agent.status),
          provider: str(agent.provider), model: (agent as any)?.model ?? null,
          providerOptions: (agent as any)?.providerOptions ?? null,
          cwd: str(agent.cwd ?? ""), workspaceId: str((a as any)?.project?.workspaceId ?? (agent as any)?.workspaceId ?? ""),
          projectName: str((a as any)?.project?.name ?? (agent as any)?.project ?? ""),
          createdAt: str(agent.created ?? agent.createdAt ?? ""), archived: (agent as any)?.archived ?? null,
        };
      }),
      workspaces: workspacesEntries.map((w) => ({
        id: str(w.id ?? w.workspaceId ?? ""), name: str(w.name), project: str(w.project), isolation: str(w.isolation), cwd: str(w.cwd ?? ""),
      })),
      projects: projectsEntries.map((pr) => ({
        id: str(pr.id ?? pr.projectId ?? ""), name: str(pr.name), source: str((pr as any)?.source ?? ""),
      })),
      providers: providersFromStatus,
      providerCount: providersFromStatus.length,
      permissions: [],
      schedules: schedEntries.map((sc) => ({
        id: str(sc.id ?? sc.scheduleId ?? ""), name: str(sc.name ?? ""), state: str(sc.state ?? sc.enabled ?? ""),
      })),
      terminals: termEntries.map((t) => ({
        id: str(t.id ?? t.terminalId ?? ""), name: str(t.name ?? t.title ?? ""), cwd: (t as any)?.cwd ?? null, status: (t as any)?.status ?? null,
      })),
    };
  } catch (cause) {
    return { name: input.daemon, reached: false, error: cause instanceof Error ? cause.message : String(cause), serverId: offer?.serverId ?? null, hostname: null, version: null, desktopManaged: null, capabilities: null, features: null, listen: null, pid: null, nodePath: null, startedAt: null, relayEndpoints: null, relayEnabled: null, transport, agents: [], workspaces: [], projects: [], providers: [], providerCount: 0, permissions: [], schedules: [], terminals: [] };
  }
}

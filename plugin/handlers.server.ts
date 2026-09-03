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
    const match = source.match(/\bVERSION\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function handleConversationSend(input: { daemon: string; agentId: string; prompt: string; fromAgentId?: string | null; fromAgentName?: string | null }) {
  let sendDaemon = daemonNameForServerId(input.daemon) ?? input.daemon;
  // Fallback: if daemon is a serverId (srv_…) and not in registry, scan registry values' offer serverId
  if (sendDaemon === input.daemon && input.daemon.startsWith("srv_")) {
    const byOffer = readRegistry(currentRegistryPath()).daemons.find((d) => parseOffer(d.value)?.serverId === input.daemon);
    if (byOffer) sendDaemon = byOffer.name;
  }
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
  } catch (err) {
    console.error(`[plugin] corrupt ${UI_PREFS_FILE}, ignoring: ${err instanceof Error ? err.message : String(err)}`);
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

// The paseo CLI has varied its output shape across versions: some commands wrap
// their list in { data: [...] }, { schedules: [...] }, { terminals: [...] },
// etc. unwrapList tries the known wrapper keys in order before falling back to
// treating the raw value itself as a list.
function unwrapList(raw: unknown, ...subkeys: string[]): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") return [];
  for (const key of subkeys) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

// daemon status is sometimes { data: { ... } } and sometimes the payload directly.
function unwrapStatusPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const data = obj.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  return obj;
}

// Null-safe field access on an unwrapped status payload.
function field(payload: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!payload) return undefined;
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") return payload[key];
  }
  return undefined;
}

function notReachedResult(name: string, error: string, offer: ReturnType<typeof parseOffer>, transport: string): { name: string; reached: boolean; error: string | null; serverId: string | null; hostname: string | null; version: string | null; desktopManaged: boolean | null; capabilities: Record<string, unknown> | null; features: Record<string, boolean> | null; listen: string | null; pid: number | null; nodePath: string | null; startedAt: string | null; relayEndpoints: string[] | null; relayEnabled: boolean | null; transport: string; agents: { agentId: string; shortId: string; name: string; status: string; provider: string; model: string | null; providerOptions: Record<string, unknown> | null; cwd: string | null; workspaceId: string | null; projectName: string | null; createdAt: string | null; archived: boolean | null }[]; workspaces: { id: string; name: string; project: string; isolation: string; cwd: string | null }[]; projects: { id: string; name: string; source: string | null }[]; providers: { provider: string; available: boolean; error: string | null }[]; providerCount: number; permissions: { id: string; agentId: string; name: string }[]; schedules: { id: string; name: string; state: string }[]; terminals: { id: string; name: string; cwd: string | null; status: string | null }[] } {
  return { name, reached: false, error, serverId: offer?.serverId ?? null, hostname: null, version: null, desktopManaged: null, capabilities: null, features: null, listen: null, pid: null, nodePath: null, startedAt: null, relayEndpoints: null, relayEnabled: null, transport, agents: [], workspaces: [], projects: [], providers: [], providerCount: 0, permissions: [], schedules: [], terminals: [] };
}

export async function handleDaemonDump(input: { daemon: string }) {
  const daemons = readRegistry(currentRegistryPath()).daemons;
  const entry = daemons.find((d) => d.name === input.daemon);
  if (!entry) {
    return notReachedResult(input.daemon, `unknown daemon '${input.daemon}'`, null, "");
  }
  const offer = parseOffer(entry.value);
  const transport = offer ? "relay" : "direct";
  const hostValue = entry.value;
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

    const p = unwrapStatusPayload(status);
    const agentsEntries    = unwrapList(agentsRes,    "data");
    const workspacesEntries = unwrapList(workspacesRes, "data");
    const projectsEntries  = unwrapList(projectsRes,  "data", "projects");
    const schedEntries     = unwrapList(schedRes,     "schedules", "data");
    const termEntries      = unwrapList(termRes,      "terminals", "data");

    const providersRaw = field(p, "providers") ?? field({ providers: (status as Record<string, unknown>)?.providers }, "providers") ?? [];
    const providersFromStatus = safe(providersRaw, (prov) => ({
      provider: str(prov.provider),
      available: (prov as Record<string, unknown>).available === true,
      error: ((prov as Record<string, unknown>).error as string | null) ?? null,
    }));

    const serverId = str(field(p, "serverId") ?? offer?.serverId ?? "");
    const hostname = str(field(p, "hostname") ?? "");
    const version  = str(field(p, "daemonVersion", "version") ?? "");

    const reached = status !== null || agentsRes !== null || workspacesRes !== null;
    if (!reached) throw new Error("all peer probes failed");

    return {
      name: input.daemon,
      reached: true,
      error: null,
      serverId,
      hostname,
      version,
      desktopManaged: (field(p, "desktopManaged") as boolean | null) ?? null,
      capabilities: null,
      features: null,
      listen: str(field(p, "listen") ?? ""),
      pid: (field(p, "pid") as number | null) ?? null,
      nodePath: str(field(p, "daemonNode", "nodePath") ?? ""),
      startedAt: str(field(p, "startedAt") ?? ""),
      relayEndpoints: field(p, "relay")
        ? [str((p?.relay as Record<string, unknown>)?.endpoint ?? ""), str((p?.relay as Record<string, unknown>)?.publicEndpoint ?? "")]
        : null,
      relayEnabled: ((p?.relay as Record<string, unknown> | undefined)?.enabled as boolean | null) ?? null,
      transport,
      agents: agentsEntries.map((a) => {
        // ls entries are sometimes { agent: { ... }, project: { ... } }, sometimes flat.
        const agent = (a.agent as Record<string, unknown>) ?? a;
        return {
          agentId: str(agent.id), shortId: str(agent.shortId), name: str(agent.name), status: str(agent.status),
          provider: str(agent.provider),
          model: (agent.model as string | null) ?? null,
          providerOptions: (agent.providerOptions as Record<string, unknown> | null) ?? null,
          cwd: str(agent.cwd ?? ""),
          workspaceId: str((a.project as Record<string, unknown>)?.workspaceId ?? agent.workspaceId ?? ""),
          projectName: str((a.project as Record<string, unknown>)?.name ?? agent.project ?? ""),
          createdAt: str(agent.created ?? agent.createdAt ?? ""),
          archived: (agent.archived as boolean | null) ?? null,
        };
      }),
      workspaces: workspacesEntries.map((w) => ({
        id: str(w.id ?? w.workspaceId ?? ""), name: str(w.name), project: str(w.project), isolation: str(w.isolation), cwd: str(w.cwd ?? ""),
      })),
      projects: projectsEntries.map((pr) => ({
        id: str(pr.id ?? pr.projectId ?? ""), name: str(pr.name), source: str(pr.source ?? ""),
      })),
      providers: providersFromStatus,
      providerCount: providersFromStatus.length,
      permissions: [],
      schedules: schedEntries.map((sc) => ({
        id: str(sc.id ?? sc.scheduleId ?? ""), name: str(sc.name ?? ""), state: str(sc.state ?? sc.enabled ?? ""),
      })),
      terminals: termEntries.map((t) => ({
        id: str(t.id ?? t.terminalId ?? ""), name: str(t.name ?? t.title ?? ""),
        cwd: (t.cwd as string | null) ?? null, status: (t.status as string | null) ?? null,
      })),
    };
  } catch (cause) {
    return notReachedResult(input.daemon, cause instanceof Error ? cause.message : String(cause), offer, transport);
  }
}

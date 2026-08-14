#!/usr/bin/env node
// paseo-cross-daemon-comms: MCP server for cross-daemon agent conversation over Paseo Relay.
//
// Lets agents on one paseo daemon talk to agents on another paseo daemon, even
// across hosts, via the paseo CLI's `--host <opaque>` flag. paseo classifies
// the host string itself: a value containing `#offer=<b64>` is a relay
// connection (E2EE); anything else is a direct host target (`host:port`,
// `tcp://…`, `unix://…`, IPC paths, bare port).
//
//   Remotes:  ~/.paseo/paseo-cross-daemon-comms.json   { name: "<offer URL | direct host>" }
//             (the registry file is the primary way to configure remotes;
//              offer from `paseo daemon pair` on the target, or a direct host)
//
// Built on the official MCP SDK (`McpServer` + `StdioServerTransport`), the
// same server paseo itself uses for its agent MCP control plane. The SDK owns
// framing, JSON-RPC, schema validation, and cancellation signals; this file
// only implements the tool logic.
//
// Env overrides (testability / power users):
//   PASEO_CROSS_DAEMON_COMMS_REMOTES    registry file path
//                                     (default ~/.paseo/paseo-cross-daemon-comms.json)
//   PASEO_CROSS_DAEMON_COMMS_PASEO      paseo binary (default "paseo")
//   PASEO_CROSS_DAEMON_COMMS_TIMEOUT_MS per paseo call timeout (default 120000)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";

const VERSION = "0.1.0";
import { z } from "zod";

const REMOTES_FILE =
  process.env.PASEO_CROSS_DAEMON_COMMS_REMOTES ||
  join(homedir(), ".paseo", "paseo-cross-daemon-comms.json");
const PASEO = process.env.PASEO_CROSS_DAEMON_COMMS_PASEO || "paseo";
const DEFAULT_TIMEOUT_MS = Number(process.env.PASEO_CROSS_DAEMON_COMMS_TIMEOUT_MS || 120000);

// remotes registry

function loadRemotes() {
  if (!existsSync(REMOTES_FILE)) return {};
  try {
    return JSON.parse(readFileSync(REMOTES_FILE, "utf8"));
  } catch {
    throw new Error(`cannot read remotes registry at ${REMOTES_FILE} (corrupt JSON?)`);
  }
}

function saveRemotes(remotes) {
  mkdirSync(dirname(REMOTES_FILE), { recursive: true });
  writeFileSync(REMOTES_FILE, JSON.stringify(remotes, null, 2) + "\n", "utf8");
}

// `--host` is opaque; paseo classifies it (a value containing `#offer=` is a
// relay connection, anything else is a direct host target). We pass the value
// through untouched (no wrapping, no legacy formats.
function hostTargetFor(remote, remotes) {
  const value = remotes[remote];
  if (value === undefined) {
    throw new Error(
      `unknown remote '${remote}' (add it to ${REMOTES_FILE} or via paseo_cross_daemon_add_remote)`,
    );
  }
  const trimmed = String(value).trim();
  if (!trimmed) throw new Error(`remote '${remote}' has an empty host value`);
  return trimmed;
}

// paseo shell-out with cancellation

function runPaseo(args, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      PASEO,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if (signal?.aborted) {
            reject(Object.assign(new Error("request cancelled"), { code: "CANCELLED" }));
            return;
          }
          if (err.killed) {
            reject(new Error(`paseo ${args[0]} timed out after ${timeoutMs}ms`));
            return;
          }
          reject(new Error((stderr || err.message || "").trim().split("\n")[0] || String(err)));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(stdout.trim());
        }
      },
    );
    if (signal) {
      if (signal.aborted) {
        child.kill("SIGTERM");
      } else {
        signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
      }
    }
  });
}

// sender identity (so recipients know who is talking and from where)

let senderCache = null;

async function gatherSenderMeta(signal) {
  if (senderCache) return senderCache;
  const meta = {
    agentId: process.env.PASEO_AGENT_ID || null,
    agentName: null,
    cwd: process.env.PASEO_AGENT_CWD || null,
    host: hostname(),
    serverId: null,
  };
  try {
    const status = await runPaseo(["daemon", "status", "--json"], {
      timeoutMs: 15000,
      signal,
    });
    if (status && typeof status === "object") {
      if (status.hostname) meta.host = status.hostname;
      meta.serverId = status.serverId || null;
    }
  } catch (err) {
    if (err?.code === "CANCELLED") throw err;
    /* keep os hostname */
  }
  if (meta.agentId) {
    try {
      const info = await runPaseo(["inspect", meta.agentId, "--json"], {
        timeoutMs: 15000,
        signal,
      });
      if (info && typeof info === "object" && info.Name) meta.agentName = info.Name;
    } catch (err) {
      if (err?.code === "CANCELLED") throw err;
      /* id only is fine */
    }
  }
  senderCache = meta;
  return meta;
}

async function senderMetaBlock(signal, target = {}) {
  const m = await gatherSenderMeta(signal);
  const envelope = {
    paseoCrossDaemonComms: {
      version: 1,
      sender: {
        agentId: m.agentId,
        agentName: m.agentName,
        host: m.host,
        daemonServerId: m.serverId,
        cwd: m.cwd,
      },
      target: {
        remote: target.remote ?? null,
        agentId: target.agentId ?? null,
      },
      sentAt: new Date().toISOString(),
    },
  };
  return `[paseo-cross-daemon-comms meta v1] ${JSON.stringify(envelope)}`;
}

// tools

const TOOL_SCHEMAS = {
  listRemotes: {},
  addRemote: {
    name: z.string(),
    offer: z
      .string()
      .describe(
        "Full pairing link (https://app.paseo.sh/#offer=…) or a direct daemon host (host:port, tcp://…, unix://…).",
      ),
  },
  removeRemote: { name: z.string() },
  listAgents: { remote: z.string() },
  inspect: { remote: z.string(), agentId: z.string() },
  send: { remote: z.string(), agentId: z.string(), prompt: z.string() },
  logs: { remote: z.string(), agentId: z.string() },
  wait: {
    remote: z.string(),
    agentId: z.string(),
    timeoutSeconds: z.number().int().positive().optional(),
  },
  listPermissions: { remote: z.string() },
  allowPermission: {
    remote: z.string(),
    agentId: z.string(),
    reqId: z.string().optional(),
    all: z.boolean().optional(),
    input: z.string().optional(),
  },
  denyPermission: {
    remote: z.string(),
    agentId: z.string(),
    reqId: z.string().optional(),
    all: z.boolean().optional(),
    message: z.string().optional(),
    interrupt: z.boolean().optional(),
  },
};

const PREFIX = "paseo_cross_daemon_";

// Surfaced to clients via the MCP `instructions` field (initialize result) so
// every model using this server gets the behavioral contract automatically.
const INSTRUCTIONS = `paseo-cross-daemon-comms: cross-daemon communication for paseo agents.

Capabilities: discover agents on other paseo daemons (list_agents, inspect), message them (send), read their timeline (logs), wait for them (wait), and resolve their permission prompts (list_permissions, allow_permission, deny_permission). Remotes are configured in a registry file (default ~/.paseo/paseo-cross-daemon-comms.json) mapping a name to a full pairing URL (https://app.paseo.sh/#offer=…) or a direct host (host:port, tcp://…); list_remotes lists the configured names, and add_remote/remove_remote manage the registry from an agent session.

Behavior:
- Every message sent via send is prefixed with a structured envelope: [paseo-cross-daemon-comms meta v1] <json> (sender identity, target, sentAt). Recipients may parse it and reply to the sender's agentId on the sender's daemon.
- send to a busy agent replaces its current run (paseo semantics). If the target may be busy, use wait (with a timeout) before sending, or expect preemption.
- Remote agents may block on permission prompts; use list_permissions to see them and allow_permission/deny_permission to respond.
- If a message contains a file payload (e.g., base64 chunks + SHA-256), assemble it exactly and verify the hash before any use (e.g., sha256sum); never hand-write code from memory; request a resend on mismatch. This server has no file-transfer tool.
- Remotes registries contain live pairing offers (serverIds, public keys, relay endpoints). Never disclose or publish them.`;

// One tool result shape, mirroring paseo's own PaseoToolResult: text content for
// every client plus structuredContent (a record) for clients that consume it.
// Arrays are wrapped so structuredContent stays a record, matching paseo's
// `ensureValidJson({ … })` convention.
function result(data) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const isRecord = data !== null && typeof data === "object" && !Array.isArray(data);
  return {
    content: [{ type: "text", text }],
    ...(isRecord ? { structuredContent: data } : {}),
  };
}

async function handleSend(input, signal) {
  const remotes = loadRemotes();
  const target = hostTargetFor(input.remote, remotes);
  const stamped = `${await senderMetaBlock(signal, {
    agentId: input.agentId,
    remote: input.remote,
  })}\n\n${input.prompt}`;
  return await runPaseo(
    ["send", input.agentId, "--host", target, "--json", "--no-wait", stamped],
    { signal },
  );
}

function registerTools(server) {
  server.registerTool(
    `${PREFIX}list_remotes`,
    { title: "List remotes", description: "List configured remote paseo daemons (names only).", inputSchema: TOOL_SCHEMAS.listRemotes },
    () => result(Object.keys(loadRemotes())),
  );

  server.registerTool(
    `${PREFIX}add_remote`,
    {
      title: "Add remote",
      description:
        "Register a remote paseo daemon by name. offer is a full pairing link (https://app.paseo.sh/#offer=…) from `paseo daemon pair` or a direct daemon host (host:port, tcp://…, unix://…).",
      inputSchema: TOOL_SCHEMAS.addRemote,
    },
    (input) => {
      const remotes = loadRemotes();
      remotes[input.name] = input.offer;
      saveRemotes(remotes);
      return result({ ok: true, remotes: Object.keys(remotes) });
    },
  );

  server.registerTool(
    `${PREFIX}remove_remote`,
    {
      title: "Remove remote",
      description: "Forget a registered remote daemon.",
      inputSchema: TOOL_SCHEMAS.removeRemote,
    },
    (input) => {
      const remotes = loadRemotes();
      if (!(input.name in remotes)) throw new Error(`unknown remote '${input.name}'`);
      delete remotes[input.name];
      saveRemotes(remotes);
      return result({ ok: true, remotes: Object.keys(remotes) });
    },
  );

  server.registerTool(
    `${PREFIX}list_agents`,
    {
      title: "List agents",
      description: "List agents on a remote daemon.",
      inputSchema: TOOL_SCHEMAS.listAgents,
    },
    async (input, extra) =>
      result(
        await runPaseo(["ls", "--host", hostTargetFor(input.remote, loadRemotes()), "--json"], {
          signal: extra.signal,
        }),
      ),
  );

  server.registerTool(
    `${PREFIX}inspect`,
    {
      title: "Inspect agent",
      description: "Inspect an agent on a remote daemon.",
      inputSchema: TOOL_SCHEMAS.inspect,
    },
    async (input, extra) =>
      result(
        await runPaseo(
          ["inspect", input.agentId, "--host", hostTargetFor(input.remote, loadRemotes()), "--json"],
          { signal: extra.signal },
        ),
      ),
  );

  server.registerTool(
    `${PREFIX}send`,
    {
      title: "Send message",
      description:
        "Send a message/task to an agent on a remote daemon (starts it if idle). Dispatches immediately (fire-and-forget, like paseo send --no-wait). Follow up with wait/logs to track the agent.",
      inputSchema: TOOL_SCHEMAS.send,
    },
    async (input, extra) => result(await handleSend(input, extra.signal)),
  );

  server.registerTool(
    `${PREFIX}logs`,
    {
      title: "View agent logs",
      description: "View the activity/timeline of an agent on a remote daemon.",
      inputSchema: TOOL_SCHEMAS.logs,
    },
    async (input, extra) =>
      result(
        await runPaseo(
          ["logs", input.agentId, "--host", hostTargetFor(input.remote, loadRemotes()), "--json"],
          { signal: extra.signal },
        ),
      ),
  );

  server.registerTool(
    `${PREFIX}wait`,
    {
      title: "Wait for agent",
      description:
        "Block until a remote agent becomes idle. Returns status \"permission\" (with kind) the moment the agent is blocked on a permission prompt, \"timeout\" if --timeoutSeconds elapses, or \"idle\" when done.",
      inputSchema: TOOL_SCHEMAS.wait,
    },
    async (input, extra) => {
      const args = ["wait", input.agentId];
      if (input.timeoutSeconds !== undefined) args.push("--timeout", String(input.timeoutSeconds));
      args.push("--host", hostTargetFor(input.remote, loadRemotes()), "--json");
      return result(await runPaseo(args, { signal: extra.signal }));
    },
  );

  server.registerTool(
    `${PREFIX}list_permissions`,
    {
      title: "List permissions",
      description: "List pending permission requests on a remote daemon.",
      inputSchema: TOOL_SCHEMAS.listPermissions,
    },
    async (input, extra) =>
      result(
        await runPaseo(
          ["permit", "ls", "--host", hostTargetFor(input.remote, loadRemotes()), "--json"],
          { signal: extra.signal },
        ),
      ),
  );

  server.registerTool(
    `${PREFIX}allow_permission`,
    {
      title: "Allow permission",
      description:
        "Allow a remote agent's permission request (reqId) or all its pending requests (all=true). input is optional modified input JSON.",
      inputSchema: TOOL_SCHEMAS.allowPermission,
    },
    async (input, extra) => {
      if (!input.reqId && !input.all) throw new Error("provide reqId or all=true");
      const args = ["permit", "allow", input.agentId];
      if (input.reqId) args.push(input.reqId);
      if (input.all) args.push("--all");
      if (input.input !== undefined) args.push("--input", input.input);
      args.push("--host", hostTargetFor(input.remote, loadRemotes()), "--json");
      return result(await runPaseo(args, { signal: extra.signal }));
    },
  );

  server.registerTool(
    `${PREFIX}deny_permission`,
    {
      title: "Deny permission",
      description:
        "Deny a remote agent's permission request (reqId) or all its pending requests (all=true). Optional message and interrupt.",
      inputSchema: TOOL_SCHEMAS.denyPermission,
    },
    async (input, extra) => {
      if (!input.reqId && !input.all) throw new Error("provide reqId or all=true");
      const args = ["permit", "deny", input.agentId];
      if (input.reqId) args.push(input.reqId);
      if (input.all) args.push("--all");
      if (input.message !== undefined) args.push("--message", input.message);
      if (input.interrupt) args.push("--interrupt");
      args.push("--host", hostTargetFor(input.remote, loadRemotes()), "--json");
      return result(await runPaseo(args, { signal: extra.signal }));
    },
  );
}

// entry

const server = new McpServer(
  {
    name: "paseo-cross-daemon-comms",
    version: VERSION,
  },
  {
    capabilities: { tools: { listChanged: false } },
    instructions: INSTRUCTIONS,
  },
);

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

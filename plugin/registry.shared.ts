import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

const DaemonEntrySchema = z.object({
  name: z.string(),
  value: z.string(),
  valid: z.boolean(),
  error: z.string().nullable(),
});

export const registryReadRpc = defineRpc({
  name: "registry.read",
  input: z.object({}),
  output: z.object({
    registryPath: z.string(),
    exists: z.boolean(),
    validJson: z.boolean(),
    parseError: z.string().nullable(),
    daemons: z.array(DaemonEntrySchema.extend({ serverId: z.string().nullable(), hostname: z.string().nullable() })),
  }),
});

export const daemonAddRpc = defineRpc({
  name: "daemon.add",
  input: z.object({
    name: z.string().min(1).max(64),
    value: z.string().min(1).max(512),
  }),
  output: z.object({
    saved: z.boolean(),
    error: z.string().nullable(),
    registryPath: z.string(),
    daemons: z.array(DaemonEntrySchema),
  }),
});

export const daemonUpdateRpc = defineRpc({
  name: "daemon.update",
  input: z.object({
    // `name` is the current key; `rename`/`value` are the optional new values.
    name: z.string().min(1).max(64),
    rename: z.string().min(1).max(64).optional(),
    value: z.string().min(1).max(512).optional(),
  }),
  output: z.object({
    saved: z.boolean(),
    error: z.string().nullable(),
    registryPath: z.string(),
    daemons: z.array(DaemonEntrySchema),
  }),
});

export const daemonRemoveRpc = defineRpc({
  name: "daemon.remove",
  input: z.object({
    name: z.string().min(1).max(64),
  }),
  output: z.object({
    saved: z.boolean(),
    error: z.string().nullable(),
    registryPath: z.string(),
    daemons: z.array(DaemonEntrySchema),
  }),
});

export const daemonHealthRpc = defineRpc({
  name: "daemon.health",
  input: z.object({}),
  output: z.object({
    results: z.array(
      z.object({
        name: z.string(),
        reachable: z.boolean(),
        error: z.string().nullable(),
        agentCount: z.number().nullable(),
      }),
    ),
  }),
});

export const serverStatusRpc = defineRpc({
  name: "server.status",
  input: z.object({}),
  output: z.object({
    installPath: z.string(),
    installed: z.boolean(),
    configured: z.boolean(),
    version: z.string().nullable(),
    syntaxOk: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const introspectAgentsRpc = defineRpc({
  name: "agents.introspect",
  input: z.object({}),
  output: z.object({
    daemons: z.array(
      z.object({
        name: z.string(),
        reachable: z.boolean(),
        error: z.string().nullable(),
        projects: z.array(
          z.object({
            project: z.string(),
            workspaces: z.array(
              z.object({
                name: z.string(),
                agents: z.array(
                  z.object({
                    agentId: z.string(),
                    shortId: z.string(),
                    name: z.string(),
                    status: z.string(),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
});

export const introduceAgentsRpc = defineRpc({
  name: "agents.introduce",
  input: z.object({
    first: z.object({ daemon: z.string(), agentId: z.string(), shortId: z.string(), name: z.string() }),
    second: z.object({ daemon: z.string(), agentId: z.string(), shortId: z.string(), name: z.string() }),
    message: z.string().min(1).max(4000),
  }),
  output: z.object({
    sends: z.array(
      z.object({
        daemon: z.string(),
        agentId: z.string(),
        ok: z.boolean(),
        error: z.string().nullable(),
      }),
    ),
  }),
});







export const daemonProbeRpc = defineRpc({
  name: "daemon.probe",
  input: z.object({ value: z.string().min(1).max(512) }),
  output: z.object({
    valid: z.boolean(),
    formatError: z.string().nullable(),
    reachable: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const uiPrefsGetRpc = defineRpc({
  name: "ui.prefs.get",
  input: z.object({}),
  output: z.object({ prereqsCollapsed: z.boolean() }),
});

export const uiPrefsSetRpc = defineRpc({
  name: "ui.prefs.set",
  input: z.object({ prereqsCollapsed: z.boolean() }),
  output: z.object({ prereqsCollapsed: z.boolean() }),
});

export const snapshotRefreshRpc = defineRpc({
  name: "snapshot.refresh",
  input: z.object({}),
  output: z.object({ updatedAt: z.string() }),
});

export const daemonDumpRpc = defineRpc({
  name: "daemon.dump",
  input: z.object({ daemon: z.string() }),
  output: z.object({
    name: z.string(),
    reached: z.boolean(),
    error: z.string().nullable(),
    // Identity (handshake server_info)
    serverId: z.string().nullable(),
    hostname: z.string().nullable(),
    version: z.string().nullable(),
    desktopManaged: z.boolean().nullable(),
    capabilities: z.record(z.string(), z.unknown()).nullable(),
    features: z.record(z.string(), z.boolean()).nullable(),
    // Connection / daemon status
    listen: z.string().nullable(),
    pid: z.number().nullable(),
    nodePath: z.string().nullable(),
    startedAt: z.string().nullable(),
    relayEndpoints: z.array(z.string()).nullable(),
    relayEnabled: z.boolean().nullable(),
    transport: z.string().nullable(),
    // Agents (full entries)
    agents: z.array(
      z.object({
        agentId: z.string(), shortId: z.string(), name: z.string(), status: z.string(),
        provider: z.string(), model: z.string().nullable(), providerOptions: z.record(z.string(), z.unknown()).nullable(),
        cwd: z.string().nullable(), workspaceId: z.string().nullable(), projectName: z.string().nullable(),
        createdAt: z.string().nullable(), archived: z.boolean().nullable(),
      }),
    ),
    workspaces: z.array(z.object({ id: z.string(), name: z.string(), project: z.string(), isolation: z.string(), cwd: z.string().nullable() })),
    projects: z.array(z.object({ id: z.string(), name: z.string(), source: z.string().nullable() })),
    // Provider snapshot + recent sessions
    providers: z.array(z.object({ provider: z.string(), available: z.boolean(), error: z.string().nullable() })),
    providerCount: z.number(),
    permissions: z.array(z.object({ id: z.string(), agentId: z.string(), name: z.string() })),
    schedules: z.array(z.object({ id: z.string(), name: z.string(), state: z.string() })),
    terminals: z.array(z.object({ id: z.string(), name: z.string(), cwd: z.string().nullable(), status: z.string().nullable() })),
  }),
});

export const identitySyncRpc = defineRpc({
  name: "identity.sync",
  input: z.object({}),
  output: z.object({
    identities: z.record(z.string(), z.string()),
    hostnames: z.record(z.string(), z.string()),
  }),
});

export const serverLocateRpc = defineRpc({
  name: "server.locate",
  input: z.object({}),
  output: z.object({
    path: z.string().nullable(),
    configured: z.boolean(),
    defaultPath: z.string(),
  }),
});

export const serverCheckRpc = defineRpc({
  name: "server.check",
  input: z.object({}),
  output: z.object({
    path: z.string().nullable(),
    located: z.boolean(),
    version: z.string().nullable(),
    expected: z.string(),
    match: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const serverSetPathRpc = defineRpc({
  name: "server.set_path",
  input: z.object({ path: z.string().min(1) }),
  output: z.object({ path: z.string(), configured: z.boolean() }),
});

export const conversationSendRpc = defineRpc({
  name: "conversation.send",
  input: z.object({
    daemon: z.string(),
    agentId: z.string(),
    prompt: z.string(),
  }),
  output: z.object({
    daemon: z.string(),
    agentId: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
  }),
});

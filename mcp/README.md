# paseo-x-comms

> This repo closely follows the latest beta versions of paseo in order to benefit
> from new features in the plugin system. Expect breaking changes between
> versions.

[paseo](https://paseo.sh) is an agent orchestrator: AI coding agents run on
paseo daemons, each managing its own workspaces, tools, and permissions.

paseo-x-comms is an MCP server that lets agents on one paseo daemon
(remote or local) talk to agents on another paseo daemon, even across hosts,
through the daemon's relay (WebSocket + E2EE) or directly over TCP.

## How it works

```
pi / opencode --MCP stdio--> paseo-x-comms (our server)
                                   │  execFile("paseo", [cmd, "--host", <target>, "--json", …])
                                   ▼
                             paseo CLI --relay (E2EE) or direct TCP--> daemon
```

- The MCP server is just a **client** of daemons: it never runs a
  daemon, and it only *talks* to agents; each agent does its own work on its
  own local daemon.
- `--host` is an **opaque string**: paseo classifies it automatically: a value
  containing `#offer=` is a relay connection (E2EE); anything else is a direct
  host target. Our registry maps a short name to that string.
- Every MCP response and every tool result flows through the official SDK, so
  framing, JSON-RPC, schema validation, and cancellation are protocol-correct
  by construction.
- The server also announces its behavioral contract to clients via the MCP
  `instructions` field (initialize result), so every model using it gets the
  envelope format and behavior notes below automatically.

## Install

### As a standalone MCP server

```sh
npm install -g @xpufx/paseo-x-comms
```

Requires the `paseo` CLI on PATH. Node ≥ 18.

### As a paseo plugin (recommended)

This repo also ships a paseo plugin that embeds the MCP server and adds the
x-comms UI (composer pill, agent panel, timeline rendering, and the
"Inject MCP into context" system-prompt toggle). The plugin is at the repo
root, so install without `--path`:

```sh
paseo plugin add <owner>/paseo-x-comms
```

paseo runs a single `npm install` at the repo root, which pulls both the
plugin dependencies and the embedded server's dependencies (`@modelcontextprotocol/sdk`,
`zod`) into one `node_modules`. The server is spawned from `./mcp` and resolves
its deps from that shared tree; no separate server install or PATH entry is
required.

## Quick start

1. On the **target** host, get its pairing offer:

   ```sh
   paseo daemon pair --json
   # → { "relayEnabled": true, "url": "https://app.paseo.sh/#offer=<b64>", ... }
   ```

   (Or, if that daemon is directly reachable over TCP, e.g. LAN, Tailscale, VPN,
   use its address, e.g. `10.0.0.5:6767`, instead of an offer.)

2. On **this** host, write the registry file with a name for that daemon
   (see `paseo-x-comms.example.json` for the format):

   `~/.paseo/paseo-x-comms.json`:

   ```json
   { "hsi": "https://app.paseo.sh/#offer=<b64>" }
   ```

   The registry is credentials; write it yourself and do not paste offers
   into agent contexts.

3. Discover and talk:

   ```
   x_comms_list_agents(daemon="hsi")
   x_comms_send(daemon="hsi", agentId="…", prompt="…")
   ```

## Tools

> Tool names are `x_comms_*`. When a client (pi, opencode)
> loads this MCP server, it may prefix tool names with its own server
> registration (for example `paseo_2d_cross_2d_daemon_2d_comms_...` in pi).
> Match the tool names the client actually exposes in its tool list; the
> documented names below are the server's own, without any client prefix.

| Tool | Purpose |
|------|---------|
| `x_comms_list_daemons` | List registered daemons (names only) |
| `x_comms_add_daemon` | Register a daemon: pairing link or direct host |
| `x_comms_remove_daemon` | Forget a registered daemon |
| `x_comms_list_agents` | List agents on a daemon |
| `x_comms_inspect` | Inspect an agent on a daemon |
| `x_comms_send` | Send a message/task to an agent on a daemon (starts it if idle) |
| `x_comms_logs` | View an agent's activity/timeline on a daemon |
| `x_comms_wait` | Block until an agent on a daemon is idle; returns `permission` the moment it stalls on a prompt |
| `x_comms_list_permissions` | List pending permission requests on a daemon |
| `x_comms_allow_permission` | Allow an agent's permission request (`reqId` or `all`) |
| `x_comms_deny_permission` | Deny an agent's permission request (`reqId` or `all`, optional `message`/`interrupt`) |

## Message envelope

`send` prepends a structured sender-meta envelope, one line, JSON:

```
[x-comms] {"xComms":{"version":3,"type":"x-comms.incoming_message","sender":{…},"target":{…},"sentAt":"…"}}
```

- `sender`: agentId, agentName, host, daemonServerId, cwd: who is talking and
  from where. Sources: `agentId`/`cwd` from the environment
  (`PASEO_AGENT_ID` / `PASEO_AGENT_CWD`), `host`/`daemonServerId` from
  `paseo daemon status --json`, `agentName` from `paseo inspect <agentId> --json`.
- `target`: daemon name + recipient agentId.
- `sentAt`: ISO timestamp.
- The prompt text itself stays prose: the meta is for machines, the prompt is
  for humans.

Recipients may parse the envelope and reply to `sender.agentId` on the
sender's daemon. The envelope is versioned (`version: 1`), so the format can
evolve without breaking older readers.

For best results, run the same version on each daemon: the envelope format,
tool names, and parameters evolve between releases, so a mismatched pair still
works, but the older side answers in its older format.

## Behavior notes

- **Send is preemptive.** A message to a busy agent replaces its current run
  (paseo's `replaceRunning: true` in `startAgentRun`, see
  `packages/server/src/server/agent/agent-prompt.ts`) on both sides. If a
  target may be busy, wait until it is idle before messaging it, or expect the
  preemption.
- **Permission loop.** An agent may block on a permission prompt; `send`
  returns `permission`, `wait` surfaces it, `list_permissions` shows details,
  and `allow_permission`/`deny_permission` answer. The loop:
  `send` → `wait` → on `permission`: `list_permissions` + allow/deny →
  `wait` … → `idle`.

## Host forms

The registry value is passed to paseo as an **opaque** `--host` string; paseo
classifies it:

- `https://app.paseo.sh/#offer=<b64>` : relay connection (E2EE)
- `host:port`, `tcp://host:port?ssl=true&password=secret`, `unix:///path`,
  IPC paths, bare port: direct connection to a reachable daemon

Only these canonical forms are accepted. Anything else (e.g. a raw base64
payload) is passed through untouched and paseo fails visibly on it. (Note:
paseo's own `--host` help text lists only `host:port` and `tcp://…`; bare
ports and `unix://` also work but are not documented in the CLI help.)

## Security

The registry (default `~/.paseo/paseo-x-comms.json`) holds live
pairing offers (serverId, daemon public keys, relay endpoints): it is
**credentials**. Never publish it. Configure it as a plain JSON file yourself
(see the example); do not paste offers into agent contexts and do not share
the file.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `PASEO_CROSS_DAEMON_COMMS_REMOTES` | `~/.paseo/paseo-x-comms.json` | registry file path |
| `PASEO_CROSS_DAEMON_COMMS_PASEO` | `paseo` | paseo binary |
| `PASEO_CROSS_DAEMON_COMMS_TIMEOUT_MS` | `120000` | per paseo call timeout |

## Registering with clients

Example configs live in this repo: `mcp-config.example.json` (pi-style
registration) and `paseo-x-comms.example.json` (registry format:
never commit your real registry).

pi (`~/.config/mcp/mcp.json`): the stdio form supports `env` (pi needs MCP
enabled for this to be picked up):

```json
{
  "mcpServers": {
    "paseo-x-comms": {
      "command": "node",
      "args": ["/path/to/paseo-x-comms.mjs"],
      "type": "stdio",
      "env": { "PASEO_CROSS_DAEMON_COMMS_REMOTES": "/path/to/paseo-x-comms.json" }
    }
  }
}
```

opencode (`~/.config/opencode/opencode.jsonc`): note the key is `environment`
(per opencode's schema):

```jsonc
{
  "mcp": {
    "paseo-x-comms": {
      "type": "local",
      "command": ["node", "/path/to/paseo-x-comms.mjs"],
      "enabled": true,
      "environment": { "PASEO_CROSS_DAEMON_COMMS_REMOTES": "/path/to/paseo-x-comms.json" }
    }
  }
}
```

## Scope

Communication only. The toolset covers discovery (`list_agents`, `inspect`),
messaging (`send`), listening (`logs`, `wait`), answering (`allow_permission`,
`deny_permission`, `list_permissions`), and the daemon registry
(`list_daemons`, `add_daemon`, `remove_daemon`). It deliberately does not
operate resources on other daemons: no schedules, terminals, workspaces, or
agent creation.

## Development

```sh
npm install
npm test          # hermetic: fake paseo CLI + temp registry, no live daemons
```

## License

Apache-2.0.

# paseo-x-comms

> Tracks the latest paseo beta (`@getpaseo/* 0.8.0-beta.1`, manifest requires `paseo >= 0.8.0`). Expect breaking changes between versions.

> Work in progress. Not all features work %100 as described.

[paseo](https://paseo.sh) is an agent orchestrator: AI coding agents run on paseo daemons, each managing workspaces, tools, and permissions. **paseo-x-comms** lets agents on one daemon talk to agents on another — even across hosts — via the daemon relay (WebSocket + E2EE) or direct TCP.

Scope: x-comms links one owner's daemons through one client UI. Pairing is explicit and local; stranger federation is out of scope (an experimental flag at most, post-1.0).

This repo ships two things:

* **Paseo plugin** (recommended) — UI + embedded MCP server. (This README is for the plugin. See below)
* **Standalone MCP server** (`mcp/`) — the same server without the paseo plugin. See **[mcp/README.md](mcp/README.md)** for its standalone install, tool reference, and protocol details.

## Plugin

The plugin embeds the MCP server and adds the X-comms UI. Agents get `x_comms_*` tools automatically; humans get surfaces to manage daemons and conversations.

### What you get

* **Main surface — X-comms** (`client/main.tsx`, surfaced via `index.client.tsx` sidebar item): registered daemons list with health (reachable/unreachable + agent count), add/edit/remove with host-form validation and reachability probe, refresh (identity + snapshot), server version check, introduce-agents picker, debug dump per daemon.
* **Composer pill** (`client/x-comms-pill.tsx`): one `X-comms` pill per agent in the composer; opens the conversation panel for that agent.
* **Agent panel** (`client/x-comms-panel.tsx` / `x-comms-timeline.tsx` / `x-comms-conversation.tsx`, plus `x-comms-tool-call.tsx` and `via-x-comms.tsx`): per-agent conversation view with timeline rendering of the `[x-comms]` envelope, send/reply, wait, and permission handling. Timeline transformers/renderers registered in `index.client.tsx` render envelopes and tool calls inline in agent timelines.
* **Server side** (`index.server.ts` + `server/`): registry, health, settings, presence announce/retract/list, and MCP injection handlers.
* **Embedded MCP server** (`mcp/paseo-x-comms.mjs`): spawned via `serverPath()` from `server/server-status.ts` (resolved from `import.meta.url` with plugin-dir fallbacks); shares the repo-root `node_modules` — no separate install or `paseo` on PATH required beyond the daemon itself.

### Install

The plugin lives at the repo root (`paseo-plugin.json` id `x-comms`):

```sh
paseo plugin add xpufx/paseo-x-comms
```

Paseo runs a node binary check plus a single `npm install` at the repo root (see `paseo-plugin.json` build), which pulls both plugin deps (`@getpaseo/plugin`, `@getpaseo/client`, `@getpaseo/protocol`, `paseo-plugin-helper`, `react-native`, etc.) and server deps (`@modelcontextprotocol/sdk`, `zod`) into one tree. The server is spawned from `./mcp` and resolves deps from that shared tree.

To update:

```sh
paseo plugin update x-comms
```

### Configure daemons

The registry is at `~/.paseo/paseo-x-comms/registry.json`:

```json
{
  "home": "https://app.paseo.sh/#offer=<b64>",
  "office": "10.0.0.5:6767"
}
```

* Value is an **opaque `--host` string** — paseo classifies it. `https://app.paseo.sh/#offer=…` is a relay connection (E2EE); anything else (`host:port`, `tcp://…`, `unix://…`, IPC path, bare port) is a direct connection. See [mcp/README.md#host-forms](mcp/README.md#host-forms).
* Manage it from the plugin UI (Main surface) or via the MCP tools `x_comms_add_daemon` / `x_comms_remove_daemon` / `x_comms_list_daemons`.
* The file holds live pairing offers (serverId, public keys, relay endpoints) — treat it as credentials, never commit it.

Quick pairing:

1. On the **target** daemon: `paseo daemon pair --json` → copy the `url` (`https://app.paseo.sh/#offer=…`). For a directly-reachable daemon, use its address instead.
2. On **this** daemon: open the X-comms Main surface → *Add daemon* → paste the offer or address. The UI probes reachability before saving (with "Add anyway" for offline hosts).

### How messaging works

Every `x_comms_send` prepends one line:

```
[x-comms] {"xComms":{"version":4,"type":"x-comms.incoming_message","sender":{…},"target":{…},"sentAt":"…","direction":"outgoing"}}
```

`sender` (agentId, agentName, host, daemonServerId, cwd) + `target` (daemon, agentId) + `sentAt`. Prompt text stays prose after the envelope. Recipients parse the envelope and reply via `x_comms_send` to `sender.agentId` on the sender's daemon. Full envelope + permission loop documented in [mcp/README.md#message-envelope](mcp/README.md#message-envelope) and [mcp/README.md#behavior-notes](mcp/README.md#behavior-notes).

Tools (via the embedded server) are `x_comms_list_daemons`, `x_comms_add_daemon`, `x_comms_remove_daemon`, `x_comms_list_agents`, `x_comms_inspect`, `x_comms_send`, `x_comms_logs`, `x_comms_wait`, `x_comms_list_permissions`, `x_comms_allow_permission`, `x_comms_deny_permission` — see [mcp/README.md#tools](mcp/README.md#tools) for the reference. The plugin's conversation/panel UI wraps `send`/`logs`/`wait`/permissions for interactive use.

## Repository layout

```
.
├── index.client.tsx          # Paseo 0.8 client entry (surfaces, pill, panel, timeline renderers)
├── index.server.ts           # Paseo 0.8 server entry (RPC + presence + injection handlers)
├── client/
│   ├── main.tsx              # Main surface (daemon registry + health + prompt)
│   ├── x-comms-pill.tsx      # Composer pill → conversation panel
│   ├── x-comms-panel.tsx     # Agent panel host
│   ├── x-comms-timeline.tsx  # Timeline / envelope rendering
│   ├── x-comms-conversation.tsx
│   ├── x-comms-tool-call.tsx # Tool-call timeline rendering
│   ├── via-x-comms.tsx
│   ├── conversations.ts      # Conversation derive (shared with tests)
│   ├── attribution.ts / peer-label.ts / tool-call.ts
│   └── *.test.ts             # Client unit tests
├── server/
│   ├── handlers.ts           # RPC handlers (registry, probe, dump, etc.)
│   ├── registry.ts           # Daemon registry + health
│   ├── settings.ts           # Plugin settings storage
│   ├── presence.ts           # Presence announce/retract/list
│   ├── injection.ts          # MCP injection for agents
│   ├── snapshot.ts / conversations-snapshot.ts
│   ├── server-status.ts      # Embedded server path resolution
│   ├── mcp-client.ts / peer-channel.ts
│   └── *.test.ts             # Server unit tests
├── shared/
│   ├── envelope.ts           # Wire envelope schema ([x-comms] parsing)
│   ├── registry.ts           # RPC definitions (zod)
│   └── conversations-snapshot.ts
├── mcp/
│   ├── paseo-x-comms.mjs      # MCP server (also bin `paseo-x-comms`)
│   ├── README.md              # standalone server docs
│   └── test/protocol.test.mjs
├── paseo-plugin.json         # id x-comms, requires paseo >= 0.8.0
└── package.json               # single install at root for plugin + server
```

## Standalone MCP

If you don't use the plugin, run the server directly:

```sh
npm install -g @xpufx/paseo-x-comms
```

Requires `paseo` CLI on PATH, Node ≥ 18. Full instructions, env overrides (`PASEO_X_COMMS_*`), and client registration examples (pi `mcp.json` vs opencode `opencode.jsonc`) are in **[mcp/README.md](mcp/README.md)**.

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test across mcp, server, and client suites (hermetic protocol tests plus presence, injection, settings, snapshot, and conversation suites)
```

No live daemons, no real `~/.paseo/paseo-x-comms/registry.json` touched in tests (`PASEO_X_COMMS_REMOTES` / `PASEO_X_COMMS_PASEO` overrides).

## License

Apache-2.0.

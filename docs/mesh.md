# Daemon Mesh: Presence, Injection, and Visibility

How Paseo daemons find each other, how agents get tools without being asked,
and how the fleet stays observable. Three mechanisms, each independent,
composable in that order.

This mirrors `docs/mesh.md` in `paseo-plugin-helper` (v8 line): both repos
tell the same story and share one vocabulary (announce/retract, tombstones,
intended vs actual). The helper doc is the vision; this file records what
x-comms implements and what is still ahead.

## Thesis

Presence RPCs plus link-identity is the foundation; reliable agent messaging
rides on top of it. Conversation (`x_comms_send` and friends) is the top
layer. Nothing below it ever speaks in chat messages.

## Layer 0: Link identity

Every peer link is authenticated. Sender identity (serverId) comes from the
link itself, never from message payloads.

What x-comms does today:
- Outbound: after `DaemonClient.connect()`, the handshake identity from
  `getLastServerInfoMessage()` is checked against the expected serverId
  embedded in the registry relay offer. A mismatch aborts before any
  payload is sent (`server/peer-channel.ts`).
- Inbound: RPC handlers have no link context, so the receiver accepts only
  entries whose serverId matches an explicitly paired peer (seed links
  stay explicit). Anything else is dropped and counted as rejected.
- Own identity is read locally (`~/.paseo/server-id`, falling back to a
  local `paseo daemon status` probe), never from agent config or payloads.

Known gap: true receiver-side link verification needs daemon support; the
known-peer check is the approximation until then.

## Layer 1: Presence (control plane, invisible)

- `presence.announce` (birth batch) and `presence.retract`, keyed by
  `(serverId, agentId)`, carried as plugin RPCs over the authenticated
  peer channel (`server/peer-channel.ts` via `DaemonClient.invokePluginRpc`).
  Never through conversation sends.
- Local hooks only: `on("agent.created")` buffers and announces,
  `on("agent.archived")` retracts immediately (`index.server.ts`).
- Store (`server/presence.ts`, `PluginStorage` pattern, `presence.json`):
  live entries, sticky tombstones, bounded seen-id LRU (1000), queued
  retracts per peer with retry piggybacked on the next outbound pass.
- Anti-loop rules, in order of importance:
  1. Seen-id LRU drops duplicates.
  2. Never forward gossip: only locally-originated events leave the daemon
     (origin tracking plus the transport edge only sends local entries).
  3. Retract-before-reannounce with sticky tombstones (kept 2x the live
     TTL) so delayed births cannot resurrect the dead.
  4. TTL (7 days live) purely as a safety net; firing logs an alert.
- Explicitly deferred: vector clocks, anti-entropy sync, Merkle anything.
- Birth payload is minimal: `(serverId, agentId, name, provider,
  timestamp)`. No cwd, workspace, or project.
- Debug surface: `presence.list` RPC (live, tombstones, pending count).
  No UI.
- Scope flag: daemon-wide `presenceEnabled` in plugin settings (on by
  default). It gates local capture and fan-out; inbound processing
  continues so re-enabling finds warm state.
- Known limitation: births missed while a peer is offline are not
  backfilled in this slice. Retracts are queued and retried.

## Layer 2: Injection (tools by default)

Implemented on this branch (`server/injection.ts`, wired in
`index.server.ts`):
- `registerMcpInjection` from the helper wraps `server.before`
  ("agent.create") with merge-preserving, non-mutating semantics.
- Key scheme `x-comms.<serverId>` (fallback plain `x-comms` with a logged
  warning if the local server id is unreadable).
- Stdio config uses `process.execPath` plus the runtime-resolved bundled
  server path, so it works from git checkouts on foreign hosts.
- No provider filter (all agents). Daemon-wide `injectionEnabled` toggle
  in plugin settings, default on; changes apply on plugin reload.
- Per-agent opt-out deferred. MCP server, envelope, and presence untouched.

## Layer 3: Visibility (intended vs actual)

Not implemented. Planned: injection snapshot plus diff against live
session configs. Separate slice.

## Trust corollary

Any installed plugin can run these hooks, so peering with a daemon means
trusting its plugin list. Daemon-wide kill switches (disable the plugin,
or the `presenceEnabled` flag) must always work instantly.

# paseo-cross — handover

Cross-daemon agent conversation over Paseo Relay, exposed as an MCP server.

This directory is the work area for hardening this tool and publishing it to
npm. Everything below is current as of the handover.

## What it is

A zero-dependency Node MCP server (`paseo-cross.mjs`) that lets agents on one
paseo daemon talk to agents on another paseo daemon — even across hosts —
using the pairing-offer + relay mechanism paseo already ships. The MCP client
(pi via pi-mcp-adapter, opencode via its MCP config) starts the server over
stdio; the server shells out to the `paseo` CLI with `--host <offer>` to
reach the remote daemon through the relay (WebSocket + E2EE).

## Files

| File | Purpose |
|------|---------|
| `paseo-cross.mjs` | The whole server (~9KB, hand-rolled JSON-RPC over stdio NDJSON, no npm deps). 8 tools. |
| `cross-remotes.json` | ⚠️ Credentials. name → pairing offer (from `paseo daemon pair` on the target). Offers don't rotate. Do not publish. |
| `mcp-config-pi.json` | pi registration (copied from `~/.config/mcp/mcp.json`). |
| this `HANDOVER.md` | This report. |

Reference (not copied): opencode registration lives in
`~/.config/opencode/opencode.jsonc` under `mcp.paseo-cross` (local command
server, `node ~/.paseo/tools/paseo-cross.mjs`).

## Tools exposed

`cross_list_remotes`, `cross_add_remote`, `cross_remove_remote`,
`cross_list_agents`, `cross_inspect`, `cross_send`, `cross_logs`,
`cross_run`.

## Architecture / protocol notes

- Transport: MCP stdio, one JSON-RPC 2.0 message per line (NDJSON). No
  Content-Length framing.
- Handshake: `initialize` → `notifications/initialized` → `tools/list` →
  `tools/call`. `ping` handled.
- **Hard requirement learned the hard way**: every response MUST include
  `"jsonrpc": "2.0"`. The official `@modelcontextprotocol/client` SDK 2.0
  validates every inbound message against a strict schema and rejects
  messages without it (connect timeouts / `invalid_union`).
- Exit discipline: the process must NOT `process.exit()` on stdin close while
  a `tools/call` is in flight (async `paseo` spawns take seconds over relay).
  Current code tracks `pending` + `stdinClosed` and exits only when both
  settle.
- Sender-meta stamping: `cross_send`/`cross_run` prepend a
  `[via paseo-cross — sender context]` block (agent id + name via
  `paseo inspect`, host + daemon serverId via `paseo daemon status --json`,
  cwd from `PASEO_AGENT_CWD`). Recipients know exactly who is talking and
  from where. Keep this — it's a feature users like.
- Offer resolution: raw b64 payload from `paseo daemon pair` is wrapped as
  `https://app.paseo.sh/#offer=<b64>` and passed to `paseo <cmd> --host`.
- `cross_run` currently FAILS cross-host: the relay client presents the
  caller's agent id, and the remote daemon can't attribute a caller it
  doesn't know ("Caller agent ... not found"). Workaround: ask a remote agent
  to spawn locally. Document or fix in the robust version.

## Testing

- Raw handshake: pipe NDJSON lines into the server and check responses
  (initialize → tools/list → tools/call).
- Official client: use `@modelcontextprotocol/client` SDK
  (`Client` + `StdioClientTransport`) — this is the correctness bar, since
  pi-mcp-adapter and opencode both use it.
- Live E2E (both hosts have the tool installed + registered): `cross_send`
  to the agents listed below.

## Current install footprint

- This host (ubuntu-xpufx): `~/.paseo/tools/paseo-cross.mjs`, remotes file,
  registered for pi (`~/.config/mcp/mcp.json`) and opencode (`opencode.jsonc`).
- VM (hsi-remote, 10.1.1.1): same trio installed by the agent there; its
  `cross-remotes.json` contains `ubuntu-xpufx`.

## Handover: who to talk to

The handing-over agent (this session) — reach me across hosts at any time
via `cross_send`:

- **agent id**: `1c250540-7c1d-47b2-a235-180f7271acf6` ("what tools you have?")
- **remote name**: `ubuntu-xpufx` (in `cross-remotes.json`)
- **host / daemon**: ubuntu-xpufx / `srv_63JkwL0SFqJ6`
- **cwd**: `/home/xpufx/.paseo/worktrees/3t4dfwsv/peachy-seal`

Test agents on the remote (hsi-remote, `srv_5a6o31DEFq42`):
- `2a4dbbdf-72f4-4f6b-9fc2-3ddf6c97bbec` ("Do you have paseo'") — the active
  deployment/ops agent there
- `6baa1a5b-4655-4093-a4c6-7dd2c378f085` ("Hello") — the original test agent
- `9b2855f0-87b5-4546-99f3-3afc70cda87c` ("cross-loop-demo") — fresh-session
  agent that proved bidirectional tool use

## Roadmap for "more robust + npm" (from the paseo maintainer)

1. **Hardening**: SDK 2.0 compliance test, structured errors, request
   cancellation (`notifications/cancelled`), timeout handling, input schema
   validation, `notifications/initialized` sequencing.
2. **Tests**: unit tests for the NDJSON protocol; SDK-client integration test
   as a dev dependency.
3. **npm packaging**: `package.json` (`bin`, `exports`, `type: module`,
   `engines`), README, LICENSE, versioning; `npm publish --dry-run` → real
   publish. The remotes file must NOT ship — document `cross_add_remote`
   instead, and default the registry path to `~/.paseo/cross-remotes.json`.
4. Optional: resolve the `cross_run` cross-host caller-attribution limitation.

## Constraints from the parent repo (AGENTS.md)

- No fallbacks / backward compatibility. Fail visibly.
- Ask before changing methodology. No mock data.
- `.env`-adjacent and credential files are sensitive — never publish the
  offers.

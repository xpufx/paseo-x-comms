# AGENTS.md: paseo-cross-daemon-comms

Agent operating rules for this repo. Hard-earned context you'd likely miss.
If any doc contradicts code or config, **the code wins**.

## What this is

An MCP server (`paseo-cross-daemon-comms.mjs`) that lets agents on one paseo daemon talk to
agents on another paseo daemon: even across hosts: using pairing offers and
the paseo relay (WebSocket + E2EE). `HANDOVER.md` (gitignored, kept local) has
the full background; read it before making structural decisions.

## Operating rules

### Questions demand verbal answers, not code

Any prompt ending with `?` is a question. Answer it verbally. Do not start
coding, renaming, or changing anything until it's answered and any ambiguity is
resolved.

### No unapproved changes

No changing methodology, paths, repo structure, or behavior without explicit
user permission. A question is not approval.

### Verify before acting

Read the code and state before answering. Never fix a theory without verifying
first (check logs, inspect state, then change code). For any structural change
(rename/move/delete): check live references: processes, env vars, configs,
installed copies: before doing it.

### No fallbacks / backward compatibility

No fallback logic, no backward compatibility, no "if this fails then..." code
paths. Every operation must be explicit and deterministic. If the primary path
fails, the failure must be visible: not silently caught by a fallback.
Exceptions require a signed code comment explicitly approved by the user.

### No mock data or placeholder functions

The product never fabricates data. Tests are hermetic by construction (fake
`paseo` binary, temp registry): that's test infrastructure, not product data.

### Credentials are sensitive

`cross-remotes.json` holds live pairing offers (serverId, daemon public keys,
relay endpoints): never commit or publish it. Same for anything `.env`-adjacent
or secret-adjacent. The remotes file is gitignored; keep it that way.

### Ask in plain chat

Ask questions in plain chat, not tool dialogs.

### Check before building

Before adding functionality, check whether paseo or this repo already has a
library, package, or function for it. The paseo source lives at
`../3rdparty/paseo` (on `main`); read it before assuming paseo behavior.
We never modify paseo itself.

### Lemon Law

If the same approach fails 5+ times without meaningful progress, stop and ask
the user. Explain what you tried and what you think the actual blocker is. Do
not spin on a 6th variation of the same thing.

## Project context

- **Live installs must not break**: the tool is installed at
  `~/.paseo/tools/paseo-cross.mjs` and registered for pi
  (`~/.config/mcp/mcp.json`) and opencode on at least two hosts. Work here may
  not disturb them; the SDK rewrite runs as a separate server (distinct
  registration name) until it deliberately replaces them.
- **Testing**: `node --test` under `test/`, hermetic: never touch real paseo
  daemons, the real `~/.paseo/cross-remotes.json`, or the live `cross_*`
  commands. Testability overrides: `PASEO_CROSS_DAEMON_COMMS_REMOTES` (registry path),
  `PASEO_CROSS_DAEMON_COMMS_PASEO` (paseo binary).
- **`--host` semantics**: opaque string. paseo classifies automatically: a
  value containing `#offer=` is a relay connection (E2EE); anything else is a
  direct host target (`host:port`, `tcp://…`, `unix://…`, IPC paths, bare
  port). Our registry holds only canonical forms: a full pairing URL or a
  direct host. Pass the value through untouched; no wrapping, no legacy
  formats.
- **Sender-meta stamping** (the `[paseo-cross-daemon-comms meta v2]` JSON
  envelope on `paseo_cross_daemon_send`) is a loved feature: keep it. Prompt
  text stays prose.
- **Protocol**: every MCP response must include `"jsonrpc": "2.0"` (the SDK 2.0
  client validates strictly). If any hand-rolled protocol code survives, that
  requirement stands.
- **VCS**: jj (jujutsu), colocated with git. Commits and history via jj; git
  remotes are for PRs (forge.mrs.aager.de/oktay/paseo-cross-daemon-comms).
  Unlike job-runner, remote pushes ARE wanted here.

## Code comments

Match the surrounding code's comment density, naming, and idiom. Only write a
comment to state a constraint the code itself can't show: never to say where a
change came from or why your change is correct. (Exception: the signed
fallback-approval comments required by the no-fallbacks rule.)

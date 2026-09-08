import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createPluginLogger,
  registerMcpInjection,
  type McpInjectionHookHandler,
  type McpInjectionServer,
  type McpStdioInjectionConfig,
} from "paseo-plugin-helper/server";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { serverPath } from "./server-status.ts";

const log = createPluginLogger("paseo-x-comms", { subsystem: "injection" });

/**
 * Injection key scheme: `x-comms.<serverId>`, namespaced per daemon so key
 * collisions are impossible by construction and the owning daemon is visible
 * in agent configs (the visibility layer reads this back). Falls back to
 * plain `x-comms` only when the local server id is unreadable.
 */
export const INJECTION_KEY_PREFIX = "x-comms.";
export const INJECTION_FALLBACK_KEY = "x-comms";

export function readLocalServerId(): string | null {
  try {
    const id = readFileSync(join(homedir(), ".paseo", "server-id"), "utf8").trim();
    return id || null;
  } catch {
    return null;
  }
}

export function injectionServerName(readId: () => string | null = readLocalServerId): string {
  const id = readId();
  if (!id) {
    log.error("injection: local server id unreadable, using fallback key (collision risk if paired daemons do the same)");
    return INJECTION_FALLBACK_KEY;
  }
  return `${INJECTION_KEY_PREFIX}${id}`;
}

export function injectionServerConfig(): McpStdioInjectionConfig {
  return {
    type: "stdio",
    command: process.execPath,
    args: [serverPath()],
  };
}

export interface InjectionGate {
  enabled: boolean;
}

/**
 * Adapt the SDK's generically-typed hook registry to the helper's
 * string-typed structural registrar. The literal "agent.create" is a valid
 * key of the SDK registry, so this is a type-level bridge only: merge
 * semantics stay entirely inside the helper. Remove if the helper widens
 * McpInjectionServer to accept the SDK BeforeRegistrar directly.
 */
export function toInjectionServer(server: PluginServerContext): McpInjectionServer {
  return {
    before: (name, handler) =>
      (server.before as (
        n: string,
        h: McpInjectionHookHandler,
      ) => () => void)(name, handler),
  };
}

/**
 * Register MCP injection when the daemon-wide toggle is on, otherwise do
 * nothing. Toggle changes take effect on plugin reload. Returns the
 * helper's remover for cleanup.
 */
export function maybeRegisterInjection(
  server: McpInjectionServer,
  gate: InjectionGate,
  overrides?: { serverName?: string; config?: McpStdioInjectionConfig },
): () => void {
  if (!gate.enabled) {
    log.info("injection: disabled by settings, skipping agent.create hook");
    return () => {};
  }
  const serverName = overrides?.serverName ?? injectionServerName();
  const config = overrides?.config ?? injectionServerConfig();
  log.info(`injection: registering agent.create hook under key '${serverName}'`);
  return registerMcpInjection(server, { serverName, config });
}

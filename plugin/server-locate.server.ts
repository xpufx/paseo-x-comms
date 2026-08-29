import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";

// The plugin and the MCP server ship together in one repo: the server lives in
// the `mcp/` directory beside the plugin entry. When paseo installs this plugin
// (from a local directory or a git clone) it records the resolved source
// directory in its own config under `plugins[<id>].path`. That directory is the
// on-disk checkout the plugin actually runs from, so the server is its sibling:
//   <configuredPath>/mcp/paseo-x-comms.mjs
// Reading our own install record is the reliable way to find it: the bundled
// plugin subprocess gets no source-dir handle from the SDK, and import.meta.url
// points at paseo's worker, not our checkout.
export const PLUGIN_ID = "paseo-x-comms-plugin";

const SERVER_RELATIVE = join("mcp", "paseo-x-comms.mjs");
const LEGACY_TOOLS_PATH = join(homedir(), ".paseo", "tools", "paseo-x-comms", "paseo-x-comms.mjs");

function paseoHome(): string {
  return process.env.PASEO_HOME && process.env.PASEO_HOME.length > 0
    ? process.env.PASEO_HOME
    : join(homedir(), ".paseo");
}

// The directory paseo stored for this plugin, from its config file. Null when
// the config is missing or does not list us (e.g. a fresh install not yet
// written, or a different PASEO_HOME than the one running the daemon).
function configuredPluginDir(): string | null {
  try {
    const configPath = join(paseoHome(), "config.json");
    if (!existsSync(configPath)) return null;
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      plugins?: Record<string, { path?: string }>;
    };
    const entry = config.plugins?.[PLUGIN_ID];
    return entry?.path && existsSync(entry.path) ? entry.path : null;
  } catch {
    return null;
  }
}

function exists(p: string): boolean {
  return p.length > 0 && existsSync(p);
}

/**
 * Resolves the bundled MCP server path. Authority order:
 *   1. an explicitly configured path (plugin UI pref) — overrides everything,
 *   2. the plugin's own install directory from paseo's config (`mcp/` sibling),
 *   3. the legacy ~/.paseo/tools copy (left by older plugin versions).
 */
export function locateServer(statedPath?: string | null): {
  path: string | null;
  configured: boolean;
  defaultPath: string;
} {
  const defaultPath = join(configuredPluginDir() ?? paseoHome(), SERVER_RELATIVE);
  if (statedPath && exists(statedPath)) {
    return { path: statedPath, configured: true, defaultPath };
  }
  const fromConfig = configuredPluginDir();
  if (fromConfig) {
    const candidate = join(fromConfig, SERVER_RELATIVE);
    if (exists(candidate)) return { path: candidate, configured: false, defaultPath };
  }
  if (exists(LEGACY_TOOLS_PATH)) {
    return { path: LEGACY_TOOLS_PATH, configured: false, defaultPath };
  }
  return { path: null, configured: false, defaultPath };
}

export { LEGACY_TOOLS_PATH };

// The server is plain ESM that imports @modelcontextprotocol/sdk + zod, which
// live in the repo's root node_modules (one package.json covers plugin + mcp).
// A git-clone install checks the repo out without running npm, so before we
// spawn the server we make sure those deps resolve; if not, we install the
// repo's own dependencies once, in place. This is the repo's single `npm
// install` — not a separate MCP-server install step for the user to perform.
const SERVER_DEPS = ["@modelcontextprotocol/sdk", "zod"];

function repoRootFor(serverPath: string): string {
  // serverPath is <checkout>/mcp/paseo-x-comms.mjs; the package.json
  // with the deps is at <checkout> (the repo root the plugin runs from).
  return dirname(dirname(serverPath));
}

function depsPresent(serverPath: string): boolean {
  const root = repoRootFor(serverPath);
  return existsSync(join(root, "package.json")) &&
    SERVER_DEPS.every((dep) => existsSync(join(root, "node_modules", dep)));
}

let ensurePromise: Promise<void> | null = null;

export function ensureServerDeps(serverPath: string): Promise<void> {
  const root = repoRootFor(serverPath);
  if (!existsSync(join(root, "package.json"))) {
    return Promise.reject(
      new Error(`no package.json at ${root}; install the plugin from a checkout that contains one`),
    );
  }
  if (depsPresent(serverPath)) return Promise.resolve();
  if (ensurePromise) return ensurePromise;
  ensurePromise = new Promise<void>((resolve, reject) => {
    execFile("npm", ["install", "--no-audit", "--no-fund", "--omit=dev"], { cwd: root, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
      ensurePromise = null;
      if (error) reject(new Error((stderr || error.message).trim().slice(0, 300)));
      else resolve();
    });
  });
  return ensurePromise;
}

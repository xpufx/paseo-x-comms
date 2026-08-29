import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { EMBEDDED_SERVER_SOURCE } from "./embedded-server.source";

const INSTALL_DEFAULT = join(homedir(), ".paseo", "tools", "paseo-cross-daemon-comms");
export const INSTALLED_SERVER_NAME = "paseo-cross-daemon-comms.mjs";
export const INSTALLED_PACKAGE_NAME = "package.json";

// The embedded server imports the MCP SDK + zod; install must ship them so the
// installed copy is runnable standalone (same deps as the published package).
const EMBEDDED_PACKAGE_JSON =
  '{"name":"paseo-cross-daemon-comms","private":true,"type":"module",' +
  '"dependencies":{"@modelcontextprotocol/sdk":"^1.30.0","zod":"^4.4.3"}}\n';

function installedServerPath(install: string): string {
  return join(install, INSTALLED_SERVER_NAME);
}

function extractVersion(source: string): string | null {
  const match = source.match(/const VERSION = "([^"]+)"/);
  return match ? match[1] : null;
}

export function serverStatus(installPath: string = INSTALL_DEFAULT): {
  installPath: string;
  installed: boolean;
  version: string | null;
  syntaxOk: boolean;
  error: string | null;
} {
  const target = installedServerPath(installPath);
  if (!existsSync(target)) {
    return { installPath, installed: false, version: null, syntaxOk: false, error: null };
  }
  try {
    const source = readFileSync(target, "utf8");
    const version = extractVersion(source);
    // A cheap deterministic syntax gate without spawning node.
    const balanced =
      (source.match(/\(/g)?.length ?? 0) === (source.match(/\)/g)?.length ?? 0) &&
      (source.match(/\{/g)?.length ?? 0) === (source.match(/\}/g)?.length ?? 0);
    return { installPath, installed: true, version, syntaxOk: balanced, error: null };
  } catch (cause) {
    return {
      installPath,
      installed: false,
      version: null,
      syntaxOk: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

function runNpm(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("npm", args, { cwd, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim().slice(0, 300)));
      else resolve();
    });
  });
}

export async function installServer(installPath: string = INSTALL_DEFAULT): Promise<{
  installPath: string;
  wroteFile: boolean;
  syntaxOk: boolean;
  version: string | null;
  error: string | null;
}> {
  const target = installedServerPath(installPath);
  try {
    mkdirSync(installPath, { recursive: true });
    const previous = existsSync(target) ? readFileSync(target, "utf8") : null;
    // The embedded server source is inlined into the plugin bundle at build
    // time, so this write is deterministic and path-independent.
    writeFileSync(target, EMBEDDED_SERVER_SOURCE, { encoding: "utf8", mode: 0o755 });
    // Ship the server's own package.json so its imports resolve; then install
    // its deps so the installed copy is genuinely runnable standalone.
    writeFileSync(join(installPath, INSTALLED_PACKAGE_NAME), EMBEDDED_PACKAGE_JSON, { encoding: "utf8", mode: 0o644 });
    await runNpm(["install", "--no-audit", "--no-fund", "--omit=dev"], installPath);
    let syntaxOk = false;
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(process.execPath, ["--check", target], (err) => (err ? reject(err) : resolve()));
      });
      syntaxOk = true;
    } catch (cause) {
      // A failed install leaves a broken dir; remove it rather than keep it.
      const { rmSync } = await import("node:fs");
      rmSync(installPath, { recursive: true, force: true });
      if (previous !== null) {
        mkdirSync(installPath, { recursive: true });
        writeFileSync(target, previous, { encoding: "utf8", mode: 0o755 });
      }
      return {
        installPath,
        wroteFile: false,
        syntaxOk: false,
        version: null,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
    return {
      installPath,
      wroteFile: true,
      syntaxOk,
      version: extractVersion(EMBEDDED_SERVER_SOURCE),
      error: null,
    };
  } catch (cause: unknown) {
    return {
      installPath,
      wroteFile: false,
      syntaxOk: false,
      version: null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function uninstallServer(installPath: string = INSTALL_DEFAULT): Promise<{
  installPath: string;
  removed: boolean;
  error: string | null;
}> {
  const target = installedServerPath(installPath);
  if (!existsSync(target)) {
    return { installPath, removed: false, error: "not installed" };
  }
  try {
    // Only remove a directory that looks like our server's install (contains
    // our server file) so an uninstall never deletes an unrelated dir here.
    const source = readFileSync(target, "utf8");
    if (!source.includes("paseo-cross-daemon-comms")) {
      return { installPath, removed: false, error: "installed file does not look like our server; not removing" };
    }
    const { rmSync } = await import("node:fs");
    rmSync(installPath, { recursive: true, force: true });
    return { installPath, removed: true, error: null };
  } catch (cause) {
    return {
      installPath,
      removed: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
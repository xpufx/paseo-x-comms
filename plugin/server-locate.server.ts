import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";

const LEGACY_TOOLS_PATH = join(homedir(), ".paseo", "tools", "paseo-cross-daemon-comms", "paseo-cross-daemon-comms.mjs");
const USER_DEFAULT = join(homedir(), ".local", "share", "paseo-cross-daemon-comms", "paseo-cross-daemon-comms.mjs");

function exists(p: string): boolean {
  return p.length > 0 && existsSync(p);
}

function whichInPath(): string | null {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, "paseo-cross-daemon-comms");
    if (exists(candidate)) return candidate;
  }
  return null;
}

function npmGlobalBin(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    execFile("npm", ["root", "-g"], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const root = stdout.trim();
      if (!root) {
        resolve(null);
        return;
      }
      const binDir = join(root, "..", "bin");
      const candidate = join(binDir, "paseo-cross-daemon-comms");
      resolve(exists(candidate) ? candidate : null);
    });
  });
}

/**
 * Locates an installed paseo-cross-daemon-comms server without installing
 * anything. Order of authority: an explicitly configured path (plugin state),
 * then the PATH, then the npm global bin, then the legacy tools copy.
 */
export async function locateServer(statedPath?: string | null): Promise<{
  path: string | null;
  configured: boolean;
  defaultPath: string;
}> {
  if (statedPath && exists(statedPath)) {
    return { path: statedPath, configured: true, defaultPath: USER_DEFAULT };
  }
  const fromPath = whichInPath();
  if (fromPath) return { path: fromPath, configured: false, defaultPath: USER_DEFAULT };
  const fromNpm = await npmGlobalBin();
  if (fromNpm) return { path: fromNpm, configured: false, defaultPath: USER_DEFAULT };
  if (exists(LEGACY_TOOLS_PATH)) {
    return { path: LEGACY_TOOLS_PATH, configured: false, defaultPath: USER_DEFAULT };
  }
  return { path: null, configured: false, defaultPath: USER_DEFAULT };
}

export { USER_DEFAULT, LEGACY_TOOLS_PATH };
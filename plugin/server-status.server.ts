import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

export function serverPath(): string {
  try {
    const url = (import.meta as unknown as { url?: string })?.url;
    if (url) {
      const here = dirname(fileURLToPath(url));
      const candidate = join(here, "mcp", "paseo-x-comms.mjs");
      if (existsSync(candidate)) return candidate;
      const candidate2 = join(here, "..", "mcp", "paseo-x-comms.mjs");
      if (existsSync(candidate2)) return candidate2;
    }
  } catch {}
  try {
    const base = join(homedir(), ".paseo", "plugins", "paseo-x-comms-plugin");
    if (existsSync(base)) {
      const entries = readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = join(base, entry.name, "checkout", "mcp", "paseo-x-comms.mjs");
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {}
  try {
    const url = (import.meta as unknown as { url?: string })?.url;
    if (url) return join(dirname(fileURLToPath(url)), "mcp", "paseo-x-comms.mjs");
  } catch {}
  throw new Error("could not locate bundled mcp server (mcp/paseo-x-comms.mjs)");
}

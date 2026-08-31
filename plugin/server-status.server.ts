import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

function candidatePaths(here: string): string[] {
  return [join(here, "mcp", "paseo-x-comms.bundled.mjs"), join(here, "mcp", "paseo-x-comms.mjs"), join(here, "..", "mcp", "paseo-x-comms.bundled.mjs"), join(here, "..", "mcp", "paseo-x-comms.mjs")];
}

export function serverPath(): string {
  try {
    const url = (import.meta as unknown as { url?: string })?.url;
    if (url) {
      const here = dirname(fileURLToPath(url));
      for (const candidate of candidatePaths(here)) if (existsSync(candidate)) return candidate;
    }
  } catch {}
  try {
    for (const pluginId of ["paseo-x-comms", "paseo-x-comms-plugin"]) {
      const base = join(homedir(), ".paseo", "plugins", pluginId);
      if (!existsSync(base)) continue;
      const entries = readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        for (const candidate of [join(base, entry.name, "checkout", "mcp", "paseo-x-comms.bundled.mjs"), join(base, entry.name, "checkout", "mcp", "paseo-x-comms.mjs")]) if (existsSync(candidate)) return candidate;
      }
    }
  } catch {}
  try {
    const url = (import.meta as unknown as { url?: string })?.url;
    if (url) {
      for (const candidate of candidatePaths(dirname(fileURLToPath(url)))) if (existsSync(candidate)) return candidate;
    }
  } catch {}
  throw new Error("could not locate bundled mcp server (mcp/paseo-x-comms.mjs)");
}

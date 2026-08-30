import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The MCP server always ships bundled with the plugin, at <pluginDir>/mcp/<name>.mjs.
// Derive that path from this module's own location so no external lookup, config
// read, or install step is needed — the server is always present wherever the
// plugin is installed.
export function serverPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "mcp", "paseo-x-comms.mjs");
}

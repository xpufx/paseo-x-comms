import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// All plugin state lives under a single namespaced subdir of paseo's home
// (~/.paseo/paseo-x-comms/) rather than littering ~/.paseo root.
export function stateDir(): string {
  return join(homedir(), ".paseo", "paseo-x-comms");
}

export const REGISTRY_DEFAULT = join(stateDir(), "registry.json");

// One-time migration: move a file from the old ~/.paseo root location into the
// namespaced state dir. Deterministic and forward-only; never a fallback path.
export function migrateFromRoot(oldName: string, newPath: string): void {
  const oldPath = join(homedir(), ".paseo", oldName);
  if (!existsSync(oldPath) || existsSync(newPath)) return;
  mkdirSync(stateDir(), { recursive: true });
  renameSync(oldPath, newPath);
}

/** The plausible canonical forms paseo classifies as --host targets. */
export function validateDaemonHost(value: string): { valid: boolean; error: string | null } {
  const v = value.trim();
  if (v.length === 0) return { valid: false, error: "empty value" };

  // Relay offer: any value containing #offer= (E2EE via relay).
  if (v.includes("#offer=")) {
    if (/^https?:\/\//.test(v)) return { valid: true, error: null };
    return { valid: false, error: "#offer= value must be a full pairing URL (https://…)" };
  }

  // tcp://host:port with optional query (ssl, password).
  if (v.startsWith("tcp://")) {
    if (/^tcp:\/\/[^/]+\/\?.*$|^tcp:\/\/[^/]+$/.test(v)) return { valid: true, error: null };
    return { valid: false, error: "tcp:// must include host[:port] (tcp://host:port?ssl=true…) " };
  }

  // unix:///path or pipe://…
  if (v.startsWith("unix://") || v.startsWith("pipe://")) {
    if (v.length > 7) return { valid: true, error: null };
    return { valid: false, error: "missing path after scheme" };
  }

  // absolute paths
  if (v.startsWith("/")) return { valid: true, error: null };

  // bare port → 127.0.0.1:port
  if (/^\d+$/.test(v)) return { valid: true, error: null };

  // host:port, IPv6 [::1]:6767
  if (/^\[[0-9a-fA-F:.]+\]:\d+$/.test(v)) return { valid: true, error: null };
  if (/^[^/:]+:\d+$/.test(v)) return { valid: true, error: null };

  return { valid: false, error: "not a canonical form (relay URL, host:port, tcp://, unix://, bare port)" };
}

export function parseRegistry(content: string): {
  ok: boolean;
  daemons: Array<{ name: string; value: string; valid: boolean; error: string | null }>;
  parseError: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    return {
      ok: false,
      daemons: [],
      parseError: cause instanceof Error ? cause.message : String(cause),
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, daemons: [], parseError: "registry must be a JSON object of name → host" };
  }
  const daemons = Object.entries(parsed as Record<string, unknown>).map(([name, value]) => {
    if (typeof value !== "string") {
      return { name, value: String(value), valid: false, error: "value must be a string" };
    }
    const checked = validateDaemonHost(value);
    return { name, value, ...checked };
  });
  return { ok: true, daemons, parseError: null };
}

export function currentRegistryPath(): string {
  const env = process.env.PASEO_CROSS_DAEMON_COMMS_REMOTES;
  if (env && env.length > 0) return env;
  migrateFromRoot("paseo-x-comms.json", REGISTRY_DEFAULT);
  return REGISTRY_DEFAULT;
}

export function validateDaemonName(name: string): { valid: boolean; error: string | null } {
  const n = name.trim();
  if (n.length === 0) return { valid: false, error: "name is required" };
  if (!/^[A-Za-z0-9._-]+$/.test(n)) {
    return { valid: false, error: "name may only contain letters, digits, '.', '_', '-'" };
  }
  return { valid: true, error: null };
}

/** Reads + validates the registry file, returning the entry list only. */
export function readRegistry(
  path: string,
): { ok: boolean; exists: boolean; parseError: string | null; daemons: Array<{ name: string; value: string; valid: boolean; error: string | null }> } {
  if (!existsSync(path)) {
    return { ok: true, exists: false, parseError: null, daemons: [] };
  }
  const content = readFileSync(path, "utf8");
  const parsed = parseRegistry(content);
  return { ok: parsed.ok, exists: true, parseError: parsed.parseError, daemons: parsed.daemons };
}

/**
 * Applies a mutation to the registry and writes it only when every entry is
 * valid. Returns fresh state plus whether the write happened; on any invalid
 * entry the file is left untouched.
 */
export function mutateRegistry(
  path: string,
  mutate: (daemons: Record<string, string>) => Record<string, string>,
): {
  saved: boolean;
  error: string | null;
  registryPath: string;
  daemons: Array<{ name: string; value: string; valid: boolean; error: string | null }>;
} {
  const current = readRegistry(path);
  if (!current.ok) {
    return {
      saved: false,
      error: `existing registry is not valid JSON: ${current.parseError}`,
      registryPath: path,
      daemons: [],
    };
  }
  const existing: Record<string, string> = {};
  for (const daemon of current.daemons) existing[daemon.name] = daemon.value;

  let next: Record<string, string>;
  try {
    next = mutate(existing);
  } catch (cause) {
    return {
      saved: false,
      error: cause instanceof Error ? cause.message : String(cause),
      registryPath: path,
      daemons: current.daemons,
    };
  }

  const entries = Object.entries(next).map(([name, value]) => ({ name, value, ...validateDaemonHost(value) }));
  const invalid = entries.find((entry) => !entry.valid);
  if (invalid) {
    return {
      saved: false,
      error: `${invalid.name} is not a valid daemon host: ${invalid.error}`,
      registryPath: path,
      daemons: entries,
    };
  }
  // Two names must not point at the same host; that is almost always a copy
  // bug, not an intentional alias.
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const prior = seen.get(entry.value);
    if (prior !== undefined) {
      return {
        saved: false,
        error: `${entry.name} and ${prior} use the same host value`,
        registryPath: path,
        daemons: entries,
      };
    }
    seen.set(entry.value, entry.name);
  }
  if (JSON.stringify(sortEntries(current.daemons)) === JSON.stringify(sortEntries(entries))) {
    // No change; still report success so the UI can settle.
    return { saved: true, error: null, registryPath: path, daemons: entries };
  }
  try {
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { saved: true, error: null, registryPath: path, daemons: entries };
  } catch (cause) {
    return {
      saved: false,
      error: cause instanceof Error ? cause.message : String(cause),
      registryPath: path,
      daemons: entries,
    };
  }
}

function sortEntries(daemons: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
  return [...daemons].sort((left, right) => left.name.localeCompare(right.name));
}
/**
 * Derives the canonical host for a registry value, when it can be done
 * deterministically. Relay offers embed their serverId, so the real host is
 * that id. Direct/local hosts carry no identity, so nothing is derived and the
 * user must supply the name themselves.
 */
export function deriveHostFromValue(value: string): string | null {
  const offer = value.match(/#offer=([A-Za-z0-9_-]+)/);
  if (offer) {
    try {
      const payload = JSON.parse(Buffer.from(offer[1], "base64").toString("utf8"));
      return typeof payload.serverId === "string" ? payload.serverId : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Consistency hint for direct hosts: if the value is a direct host (host:port
 * or tcp://host:port) and the entered name does not match the URL host part,
 * surface that as a warning. The name may legitimately differ from an IP, so
 * this is advisory, not a rejection.
 */
export function directHostMismatch(name: string, value: string): string | null {
  if (value.includes("#offer=") || value.startsWith("unix://") || value.startsWith("/")) {
    return null;
  }
  const urlHost = value.replace(/^tcp:\/\//, "").replace(/^ws:\/\//, "").replace(/\?.*$/, "").split(":")[0];
  if (!urlHost) return null;
  const nameHost = name.split(":")[0];
  if (nameHost && urlHost !== nameHost && !nameHost.includes(urlHost) && !urlHost.includes(nameHost)) {
    return `host '${nameHost}' does not match the address host '${urlHost}'`;
  }
  return null;
}

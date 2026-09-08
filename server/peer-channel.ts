import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { buildDaemonWebSocketUrl, buildRelayWebSocketUrl } from "@getpaseo/protocol/daemon-endpoints";
import { createPluginLogger, safeSpawn } from "paseo-plugin-helper/server";
import { withTimeout } from "paseo-plugin-helper/shared";

const log = createPluginLogger("paseo-x-comms", { subsystem: "peer-channel" });
const CONNECT_TIMEOUT_MS = 8000;

export interface PeerTarget {
  name: string;
  endpoint: string;
  url: string;
  e2eePublicKeyB64: string | null;
  expectedServerId: string | null;
}

interface ParsedOffer {
  serverId: string | null;
  daemonPublicKeyB64: string | null;
  relayEndpoint: string | null;
  useTls: boolean;
}

function parseOffer(value: string): ParsedOffer | null {
  const m = value.match(/#offer=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const payload = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    return {
      serverId: typeof payload.serverId === "string" ? payload.serverId : null,
      daemonPublicKeyB64: typeof payload.daemonPublicKeyB64 === "string" ? payload.daemonPublicKeyB64 : null,
      relayEndpoint: typeof payload.relay?.endpoint === "string" ? payload.relay.endpoint : null,
      useTls: payload.relay?.useTls === true,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a registry endpoint to a dialable peer target. Relay offers carry
 * everything needed (relay URL, daemon key, expected serverId). Direct
 * host:port targets carry no identity: expectedServerId stays null and the
 * link check falls back to whatever the handshake reports.
 */
export function resolvePeerTarget(name: string, endpoint: string): PeerTarget {
  const value = endpoint.trim();
  const offer = parseOffer(value);
  if (offer) {
    if (!offer.relayEndpoint || !offer.daemonPublicKeyB64 || !offer.serverId) {
      throw new Error(`relay offer for '${name}' is missing endpoint, key, or serverId`);
    }
    return {
      name,
      endpoint: value,
      url: buildRelayWebSocketUrl({
        endpoint: offer.relayEndpoint,
        useTls: offer.useTls,
        serverId: offer.serverId,
        role: "client",
      }),
      e2eePublicKeyB64: offer.daemonPublicKeyB64,
      expectedServerId: offer.serverId,
    };
  }
  const direct = value.replace(/^tcp:\/\//, "").split("?")[0];
  if (/^[^/:]+:\d+$/.test(direct) || /^\[[0-9a-fA-F:.]+\]:\d+$/.test(direct)) {
    return {
      name,
      endpoint: value,
      url: buildDaemonWebSocketUrl(direct, { useTls: false }),
      e2eePublicKeyB64: null,
      expectedServerId: null,
    };
  }
  throw new Error(`cannot dial '${name}': unsupported endpoint form for presence RPC`);
}

let cachedLocalServerId: string | null = null;

/**
 * This daemon's own serverId. Read from the daemon-persisted server-id file,
 * falling back to a local status probe. Never from agent config or payloads.
 */
export async function localServerId(): Promise<string> {
  if (cachedLocalServerId) return cachedLocalServerId;
  try {
    const id = readFileSync(join(homedir(), ".paseo", "server-id"), "utf8").trim();
    if (id) {
      cachedLocalServerId = id;
      return id;
    }
  } catch {
    // Fall through to the status probe.
  }
  const r = await withTimeout(
    safeSpawn("paseo", ["daemon", "status", "--json"], { timeoutMs: 8000 }),
    8000,
    "local daemon status",
  );
  if (r.code !== 0) throw new Error(`local daemon status failed: ${(r.stderr || `exit ${r.code}`).trim()}`);
  const parsed = JSON.parse(r.stdout) as { serverId?: unknown };
  if (typeof parsed.serverId !== "string" || !parsed.serverId) {
    throw new Error("local daemon status reports no serverId");
  }
  cachedLocalServerId = parsed.serverId;
  return parsed.serverId;
}

/**
 * Invoke a plugin RPC on a peer over its authenticated channel and return the
 * link-verified serverId of the far end. The handshake identity is checked
 * against the expected id when the endpoint carries one (relay offers do);
 * a mismatch aborts before any payload is sent.
 */
export async function invokePeerRpc(
  target: PeerTarget,
  method: string,
  input: unknown,
): Promise<{ peerServerId: string | null }> {
  const client = new DaemonClient({
    url: target.url,
    clientId: randomUUID(),
    clientType: "cli",
    appVersion: "paseo-x-comms/0.3.0",
    e2ee: target.e2eePublicKeyB64 ? { enabled: true, daemonPublicKeyB64: target.e2eePublicKeyB64 } : undefined,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    reconnect: { enabled: false },
  });
  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, `connect ${target.name}`);
    const peerServerId = client.getLastServerInfoMessage()?.serverId ?? null;
    if (target.expectedServerId && peerServerId && peerServerId !== target.expectedServerId) {
      throw new Error(`peer identity mismatch for '${target.name}': link reports ${peerServerId}`);
    }
    await withTimeout(
      client.invokePluginRpc("x-comms", method, input),
      CONNECT_TIMEOUT_MS,
      `peer rpc ${method} ${target.name}`,
    );
    return { peerServerId };
  } finally {
    await client.close().catch((cause: unknown) => {
      log.error(`peer close failed for '${target.name}': ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  }
}

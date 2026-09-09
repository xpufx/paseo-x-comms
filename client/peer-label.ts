import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { registryReadRpc } from "../shared/registry";

/**
 * Canonical daemon display: `alias (srv_xxx)`. Both halves always render
 * together: never a bare id, never a bare alias. Peers without a registry
 * entry (unpaired senders) render as `unknown (srv_xxx)`.
 */
export function formatPeerDisplay(alias: string | null | undefined, serverId: string | null | undefined): string {
  const id = serverId ?? "unknown-id";
  const name = alias ?? "unknown";
  return `${name} (${id})`;
}

function aliasFor(serverId: string | null | undefined, byServerId: Map<string, string>): string | null {
  if (!serverId) return null;
  return byServerId.get(serverId) ?? null;
}

/**
 * Resolve a serverId to its local registry alias. Returns null while
 * loading or when the id is not paired.
 */
export function usePeerAlias(serverId: string | null | undefined): string | null {
  const callRead = useRpc(registryReadRpc);
  const read = useQuery({
    queryKey: ["registry-read"],
    queryFn: () => callRead({}),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  if (!serverId || !read.data) return null;
  const byServerId = new Map<string, string>();
  for (const daemon of read.data.daemons) {
    if (daemon.serverId) byServerId.set(daemon.serverId, daemon.name);
  }
  return aliasFor(serverId, byServerId);
}

/**
 * Format a peer when both halves are already known (list rows, dump views,
 * confirmations). Falls back to `unknown (srv)` when the alias is missing
 * rather than rendering either half bare.
 */
export function usePeerDisplay(serverId: string | null | undefined, knownAlias?: string | null): string {
  const resolved = usePeerAlias(serverId);
  return formatPeerDisplay(knownAlias ?? resolved, serverId);
}

export interface CounterpartyRef {
  daemon?: string | null;
  daemonServerId?: string | null;
}

/**
 * Split a counterparty ref into display halves. Either field may carry
 * either half depending on where the ref was built, so srv_-shaped values
 * always count as the id half.
 */
export function splitCounterparty(cp: CounterpartyRef): { alias: string | null; serverId: string | null } {
  const values = [cp.daemon, cp.daemonServerId].filter((v): v is string => !!v);
  const serverId = values.find((v) => v.startsWith("srv_")) ?? null;
  const alias = values.find((v) => !v.startsWith("srv_")) ?? null;
  return { alias, serverId };
}

export function formatCounterparty(cp: CounterpartyRef): string {
  const { alias, serverId } = splitCounterparty(cp);
  return formatPeerDisplay(alias, serverId);
}

/**
 * Full counterparty label with registry enrichment: fills a missing half
 * from the local registry (name to id or id to alias) before formatting.
 * Shares the cached registry-read query with the other hooks.
 */
export function useCounterpartyLabel(cp: CounterpartyRef): string {
  const callRead = useRpc(registryReadRpc);
  const read = useQuery({
    queryKey: ["registry-read"],
    queryFn: () => callRead({}),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const { alias, serverId } = splitCounterparty(cp);
  let id = serverId;
  let name = alias;
  if (read.data) {
    if (!id && name) {
      id = read.data.daemons.find((d) => d.name === name)?.serverId ?? null;
    }
    if (!name && id) {
      name = read.data.daemons.find((d) => d.serverId === id)?.name ?? null;
    }
  }
  return formatPeerDisplay(name, id);
}

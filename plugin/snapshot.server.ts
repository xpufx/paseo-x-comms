import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { currentRegistryPath, readRegistry, stateDir, migrateFromRoot } from "./registry.server";

const PROBE_TIMEOUT_MS = 15000;
const SNAPSHOT_FILE = join(stateDir(), "snapshot.json");
migrateFromRoot("paseo-x-comms-snapshot.json", SNAPSHOT_FILE);
const STALE_MS = 60_000;

export interface SnapshotAgent {
  agentId: string;
  shortId: string;
  name: string;
  status: string;
}

export interface SnapshotWorkspace {
  name: string;
  agents: SnapshotAgent[];
}

export interface SnapshotProject {
  project: string;
  workspaces: SnapshotWorkspace[];
}

export interface DaemonSnapshotEntry {
  name: string;
  value: string;
  reachable: boolean;
  error: string | null;
  projects: SnapshotProject[];
}

export interface DaemonSnapshot {
  updatedAt: string;
  daemons: DaemonSnapshotEntry[];
}

let snapshot: DaemonSnapshot | null = null;
let inflight: Promise<DaemonSnapshot> | null = null;

function runPaseoJson(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("paseo", args, { timeout: PROBE_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("paseo returned non-JSON output"));
        }
      }
    });
  });
}

async function probeDaemon(value: string): Promise<{
  reachable: boolean;
  error: string | null;
  projects: SnapshotProject[];
}> {
  try {
    const [agentsRaw, workspacesRaw] = await Promise.all([
      // --global: include agents in every workspace, not just the daemon cwd.
      runPaseoJson(["ls", "--global", "--host", value, "--json"]),
      runPaseoJson(["workspace", "ls", "--host", value, "--json"]),
    ]);
    const agents = Array.isArray(agentsRaw) ? agentsRaw : [];
    const workspaces = Array.isArray(workspacesRaw) ? workspacesRaw : [];

    // Map cwd -> { project, name } for grouping agents under their workspace.
    const infoByCwd = new Map<string, { project: string; name: string }>();
    for (const ws of workspaces) {
      if (typeof ws?.cwd === "string" && typeof ws?.name === "string") {
        infoByCwd.set(ws.cwd, {
          project: typeof ws.project === "string" && ws.project ? ws.project : "(no project)",
          name: ws.name,
        });
      }
    }

    const agentsByCwd = new Map<string, SnapshotAgent[]>();
    for (const agent of agents) {
      // Skip non-active agents; the registry's view is of current agents.
      const status = typeof agent.status === "string" ? agent.status : "unknown";
      if (status === "closed" || status === "archived") continue;
      const id = typeof agent.id === "string" ? agent.id : String(agent.id ?? "");
      const key = typeof agent.cwd === "string" ? agent.cwd : "";
      if (!agentsByCwd.has(key)) agentsByCwd.set(key, []);
      agentsByCwd.get(key)!.push({
        agentId: id,
        shortId: typeof agent.shortId === "string" ? agent.shortId : id.slice(0, 8),
        name: typeof agent.name === "string" ? agent.name : id,
        status,
      });
    }

    const byProject = new Map<string, Map<string, SnapshotAgent[]>>();
    for (const [cwd, list] of agentsByCwd) {
      // Agents whose cwd matches no listed workspace are grouped under their
      // actual working directory, so the label stays truthful.
      const info = infoByCwd.get(cwd) ?? { project: "(no workspace)", name: cwd };
      if (!byProject.has(info.project)) byProject.set(info.project, new Map());
      const byWorkspace = byProject.get(info.project)!;
      if (!byWorkspace.has(info.name)) byWorkspace.set(info.name, []);
      byWorkspace.get(info.name)!.push(...list);
    }

    const projects: SnapshotProject[] = [];
    for (const [project, byWorkspace] of byProject) {
      const workspacesOut: SnapshotWorkspace[] = [];
      for (const [name, list] of byWorkspace) {
        workspacesOut.push({ name, agents: list.sort((a, b) => a.name.localeCompare(b.name)) });
      }
      projects.push({ project, workspaces: workspacesOut.sort((a, b) => a.name.localeCompare(b.name)) });
    }
    projects.sort((a, b) => a.project.localeCompare(b.project));
    return { reachable: true, error: null, projects };
  } catch (cause) {
    return { reachable: false, error: cause instanceof Error ? cause.message : String(cause), projects: [] };
  }
}

function doRefresh(): Promise<DaemonSnapshot> {
  return (async () => {
    const current = readRegistry(currentRegistryPath());
    const daemons: DaemonSnapshotEntry[] = current.ok
      ? await Promise.all(
          current.daemons.map(async (daemon) => ({
            name: daemon.name,
            value: daemon.value,
            ...(await probeDaemon(daemon.value)),
          })),
        )
      : [];
    const next: DaemonSnapshot = { updatedAt: new Date().toISOString(), daemons };
    snapshot = next;
    try {
      writeFileSync(SNAPSHOT_FILE, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch {
      // The in-memory snapshot is authoritative; a failed state file write is not fatal.
    }
    return next;
  })();
}

/** Re-probe every registered daemon and replace the snapshot. */
export function refreshSnapshot(): Promise<DaemonSnapshot> {
  if (!inflight) {
    inflight = doRefresh().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Returns the current snapshot, refreshing only if it is stale. */
export function getSnapshotFresh(): Promise<DaemonSnapshot> {
  if (snapshot && Date.now() - new Date(snapshot.updatedAt).getTime() < STALE_MS) {
    return Promise.resolve(snapshot);
  }
  return refreshSnapshot();
}

/** Kick off a first snapshot at plugin load; never throws at startup. */
export function initializeSnapshot(): void {
  void refreshSnapshot().catch((error) => {
    console.error(`[snapshot] initial refresh failed: ${error instanceof Error ? error.message : error}`);
  });
}

export function agentCountFor(entry: DaemonSnapshotEntry): number {
  return entry.projects.reduce(
    (total, project) => total + project.workspaces.reduce((sub, ws) => sub + ws.agents.length, 0),
    0,
  );
}
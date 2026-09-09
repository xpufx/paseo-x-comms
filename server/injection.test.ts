import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentCreateInjectionRequest,
  McpInjectionHookHandler,
  McpInjectionServer,
} from "paseo-plugin-helper/server";
import {
  INJECTION_FALLBACK_KEY,
  INJECTION_KEY_PREFIX,
  injectionServerConfig,
  injectionServerName,
  maybeRegisterInjection,
  resolveNodeCommand,
  stableServerPath,
  syncStableServer,
} from "./injection.ts";

interface StubServer extends McpInjectionServer {
  hooks: Map<string, McpInjectionHookHandler>;
  removed: boolean;
}

function createStubServer(): StubServer {
  const hooks = new Map<string, McpInjectionHookHandler>();
  return {
    hooks,
    removed: false,
    before(name: string, handler: McpInjectionHookHandler): () => void {
      hooks.set(name, handler);
      return () => {
        if (hooks.get(name) === handler) hooks.delete(name);
      };
    },
  };
}

const KEY = `${INJECTION_KEY_PREFIX}srv_test123`;

function withSandboxedHome(fn: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "xcomms-home-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
}
const CONFIG = { type: "stdio" as const, command: process.execPath, args: ["/plugins/x-comms/mcp/paseo-x-comms.bundled.mjs"] };

function requestWithUserServer(): AgentCreateInjectionRequest {
  return {
    config: {
      provider: "opencode",
      cwd: "/work",
      mcpServers: {
        userServer: { type: "http" as const, url: "http://localhost:9000/mcp" },
      },
    },
  };
}

describe("mcp injection", () => {
  it("registers agent.create and merges under the namespaced key, preserving user servers", () => {
    const server = createStubServer();
    maybeRegisterInjection(server, { enabled: true }, { serverName: KEY, config: CONFIG });
    assert.equal(server.hooks.size, 1);
    assert.ok(server.hooks.has("agent.create"));
    const result = server.hooks.get("agent.create")!({ request: requestWithUserServer() }) as AgentCreateInjectionRequest;
    assert.deepEqual(result.config.mcpServers?.["userServer"], { type: "http", url: "http://localhost:9000/mcp" });
    assert.deepEqual(result.config.mcpServers?.[KEY], CONFIG);
  });

  it("creates mcpServers when the request has none", () => {
    const server = createStubServer();
    maybeRegisterInjection(server, { enabled: true }, { serverName: KEY, config: CONFIG });
    const result = server.hooks.get("agent.create")!({
      request: { config: { provider: "opencode", cwd: "/w" } },
    }) as AgentCreateInjectionRequest;
    assert.deepEqual(result.config.mcpServers, { [KEY]: CONFIG });
  });

  it("applies to every agent: no filter is registered", () => {
    const server = createStubServer();
    maybeRegisterInjection(server, { enabled: true }, { serverName: KEY, config: CONFIG });
    for (const provider of ["opencode", "claude", "anything"]) {
      const result = server.hooks.get("agent.create")!({
        request: { config: { provider, cwd: "/w" } },
      }) as AgentCreateInjectionRequest;
      assert.deepEqual(result.config.mcpServers?.[KEY], CONFIG);
    }
  });

  it("never mutates the incoming request object", () => {
    const server = createStubServer();
    maybeRegisterInjection(server, { enabled: true }, { serverName: KEY, config: CONFIG });
    const request = requestWithUserServer();
    const snapshot = JSON.parse(JSON.stringify(request));
    server.hooks.get("agent.create")!({ request });
    assert.deepEqual(request, snapshot);
  });

  it("returns a remover that unregisters the hook", () => {
    const server = createStubServer();
    const remove = maybeRegisterInjection(server, { enabled: true }, { serverName: KEY, config: CONFIG });
    assert.ok(server.hooks.has("agent.create"));
    remove();
    assert.ok(!server.hooks.has("agent.create"));
  });

  it("registers nothing when the toggle is off", () => {
    const server = createStubServer();
    const remove = maybeRegisterInjection(server, { enabled: false }, { serverName: KEY, config: CONFIG });
    assert.equal(server.hooks.size, 0);
    remove();
  });

  it("namespaces the key per daemon id", () => {
    assert.equal(injectionServerName(() => "srv_abc"), `${INJECTION_KEY_PREFIX}srv_abc`);
    assert.equal(injectionServerName(() => null), INJECTION_FALLBACK_KEY);
  });

  it("builds a stdio config pointing at the bundled server", () => {
    withSandboxedHome(() => {
      const config = injectionServerConfig();
      assert.equal(config.type, "stdio");
      assert.ok(config.args?.[0]?.endsWith("paseo-x-comms.bundled.mjs"));
    });
  });

  it("never emits an Electron app binary as the server command", () => {
    assert.equal(resolveNodeCommand("/opt/Paseo/Paseo"), "node");
    assert.equal(resolveNodeCommand("/Applications/Paseo.app/Contents/MacOS/Paseo"), "node");
    assert.equal(resolveNodeCommand("/usr/bin/node"), "/usr/bin/node");
    assert.equal(resolveNodeCommand(process.execPath), process.execPath);
  });

  it("resolves the stable path under the state dir bin", () => {
    assert.equal(
      stableServerPath("/fake/home/.paseo/paseo-x-comms"),
      join("/fake/home/.paseo/paseo-x-comms", "bin", "paseo-x-comms.bundled.mjs"),
    );
  });

  it("copies the bundle to the stable path and refreshes on change", () => {
    const dir = mkdtempSync(join(tmpdir(), "xcomms-stable-"));
    try {
      const source = join(dir, "source.mjs");
      const dest = join(dir, "state", "bin", "paseo-x-comms.bundled.mjs");
      writeFileSync(source, "v1");
      assert.equal(syncStableServer(source, dest), dest);
      assert.equal(readFileSync(dest, "utf8"), "v1");
      assert.equal(syncStableServer(source, dest), dest);
      writeFileSync(source, "v2");
      syncStableServer(source, dest);
      assert.equal(readFileSync(dest, "utf8"), "v2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injected args point at the stable bin, never at /checkout/", () => {
    withSandboxedHome((home) => {
      const config = injectionServerConfig();
      const [script] = config.args ?? [];
      assert.ok(script, "injected config must carry the server script");
      assert.ok(!script.includes("/checkout/"), `injected path must not rot on update: ${script}`);
      assert.equal(script, join(home, ".paseo", "paseo-x-comms", "bin", "paseo-x-comms.bundled.mjs"));
      assert.ok(existsSync(script), "stable server must exist after sync");
    });
  });

  it("end-to-end injected config never contains /checkout/", () => {
    withSandboxedHome(() => {
      const server = createStubServer();
      maybeRegisterInjection(server, { enabled: true }, { serverName: KEY });
      const result = server.hooks.get("agent.create")!({
        request: { config: { provider: "opencode", cwd: "/w" } },
      }) as AgentCreateInjectionRequest;
      const entry = result.config.mcpServers?.[KEY] as { args?: string[] } | undefined;
      const [script] = entry?.args ?? [];
      assert.ok(script, "hook must inject the server script");
      assert.ok(!script.includes("/checkout/"), `injected path must not rot on update: ${script}`);
    });
  });
});

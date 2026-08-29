import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

/**
 * Minimal MCP stdio client for talking to the installed paseo-x-comms
 * server. Deliberately dependency-free: the handshake is small and stable
 * (initialize -> notifications/initialized -> tools/call), and it keeps the
 * plugin bundle lean instead of bundling the whole MCP SDK.
 */
export class McpStdioClient {
  private readonly child: ChildProcess;
  private readonly lines: ReturnType<typeof createInterface>;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private initialized = false;

  constructor(serverPath: string, args: string[] = []) {
    this.child = spawn(process.execPath, [serverPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr?.on("data", (chunk) => {
      // Server diagnostics on stderr; useful for debugging without dying.
      if (process.env.PASEO_CROSS_DAEMON_COMMS_DEBUG) {
        console.error(`[mcp-client] ${String(chunk)}`);
      }
    });
    const stdout = this.child.stdout;
    if (!stdout) throw new Error("server stdout is unavailable");
    this.lines = createInterface({ input: stdout });
    this.lines.on("line", (line) => {
      let message: { id?: string; error?: unknown; result?: unknown };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof message.id !== "string") return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  private send(message: Record<string, unknown>): void {
    const stdin = this.child.stdin;
    if (!stdin) throw new Error("server stdin is unavailable");
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async connect(): Promise<{ serverInfo: unknown; tools: Array<{ name: string }> }> {
    const init = (await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "paseo-x-comms-plugin", version: "0.0.1" },
    })) as { serverInfo?: unknown; capabilities?: unknown };
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    this.initialized = true;
    const listed = (await this.request("tools/list", {})) as { tools?: Array<{ name: string }> };
    return { serverInfo: init.serverInfo, tools: listed.tools ?? [] };
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    if (!this.initialized) throw new Error("MCP client is not connected");
    const result = (await this.request("tools/call", { name, arguments: arguments_ })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    if (result.isError) {
      const text = result.content?.map((part) => part.text ?? "").join("\n") ?? "tool error";
      throw new Error(text.slice(0, 400));
    }
    const text = result.content?.map((part) => part.text ?? "").join("\n") ?? "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  close(): void {
    this.initialized = false;
    const stdin = this.child.stdin;
    if (stdin) stdin.end();
    for (const pending of this.pending.values()) pending.reject(new Error("MCP client closed"));
    this.pending.clear();
    this.lines.close();
    const child = this.child;
    setTimeout(() => {
      if (child && !child.killed) child.kill();
    }, 1000).unref();
  }
}
import { McpClient } from "paseo-plugin-helper/mcp";
import { createPluginLogger } from "paseo-plugin-helper/server";

const log = createPluginLogger("paseo-x-comms", { subsystem: "mcp-client" });

/**
 * Thin wrapper around the helper McpClient for talking to the installed
 * paseo-x-comms server over stdio. Keeps the call sites stable: connect
 * returns server info plus tool names, callTool returns parsed JSON payloads,
 * and close releases the child process tree.
 */
export class McpStdioClient {
  private readonly client: McpClient;

  constructor(serverPath: string, args: string[] = []) {
    this.client = McpClient.forStdio(process.execPath, [serverPath, ...args], undefined, {
      clientInfo: { name: "paseo-x-comms", version: "0.3.0" },
      timeoutMs: 15000,
    });
  }

  async connect(): Promise<{ serverInfo: unknown; tools: Array<{ name: string }> }> {
    await this.client.initialize();
    const tools = await this.client.listTools();
    return { serverInfo: this.client.serverInfo, tools: tools.map((tool) => ({ name: tool.name })) };
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callTool(name, arguments_);
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
    this.client.close().catch((error: unknown) => {
      log.error(`mcp client close failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

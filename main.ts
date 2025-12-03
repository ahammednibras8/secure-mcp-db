import { McpServer } from "npm:@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import { handleToolCall, tools } from "./src/server.ts";

const server = new McpServer({
  name: "secure-mcp-db",
  version: "1.0.0",
});

for (const [toolName, def] of Object.entries(tools)) {
  server.tool(
    toolName,
    def.description,
    def.inputSchema.shape,
    async (args: unknown) => {
      const result = await handleToolCall(toolName, args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Secure MCP DB Server running via McpServer on stdio...");
}

run().catch(console.error);

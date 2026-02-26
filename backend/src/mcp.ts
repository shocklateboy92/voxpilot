import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { z } from "zod/v4";

function createMcpServer() {
  const server = new McpServer({
    name: "voxpilot",
    version: "0.1.0",
  });

  // Skeleton hello-world tool
  server.registerTool(
    "hello",
    {
      title: "Hello",
      description: "A simple greeting tool that returns a hello message",
      inputSchema: {
        name: z.string().describe("Name to greet").default("world"),
      },
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}!` }],
    }),
  );

  return server;
}

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

const router = new Hono();

router.all("/", async (c) => {
  const sessionId = c.req.header("mcp-session-id");

  // Existing session — reuse transport
  if (sessionId) {
    const transport = transports.get(sessionId);
    if (transport) {
      return transport.handleRequest(c.req.raw);
    }
  }

  // New initialization request — create transport + server
  if (c.req.method === "POST") {
    const body = await c.req.json();
    if (isInitializeRequest(body)) {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
      return transport.handleRequest(c.req.raw, { parsedBody: body });
    }
  }

  return c.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: null,
    },
    400,
  );
});

export { router as mcpRouter };

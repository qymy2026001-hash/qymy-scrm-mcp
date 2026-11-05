import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { SharedBearerAuthResolver, type AuthResolver } from "./auth";
import { ChatwootClient } from "./chatwoot/client";
import { logError, logInfo } from "./log";
import { createScrmMcpServer } from "./mcp/server";

const authResolver: AuthResolver = new SharedBearerAuthResolver();

function emptyServer(): McpServer {
  return new McpServer({ name: "qymy-scrm", version: "0.1.0" });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    logInfo("request", { method: request.method, path: url.pathname });

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({ service: "qymy-scrm-mcp", phase: "p0", mcp: "/mcp" });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "OPTIONS") {
      return createMcpHandler(emptyServer, { route: "/mcp" })(request, env, ctx);
    }

    const auth = await authResolver.resolve(request, env);
    if (!auth.ok) {
      if (auth.status === 401) logInfo("mcp_auth_denied", { status: 401 });
      else logError("mcp_auth_failed", { status: auth.status });
      return new Response(auth.message, {
        status: auth.status,
        headers: {
          "cache-control": "no-store",
          "www-authenticate": 'Bearer realm="qymy-scrm-mcp"',
        },
      });
    }

    const client = new ChatwootClient(auth.principal.chatwoot);
    return createMcpHandler(() => createScrmMcpServer(client), { route: "/mcp" })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

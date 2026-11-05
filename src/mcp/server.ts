import { McpServer } from "@modelcontextprotocol/server";
import { logError, logInfo } from "../log";
import {
  getContactInput,
  getConversationInput,
  listConversationsInput,
  listMessagesInput,
  searchContactsInput,
  sendReplyInput,
} from "./schemas";
import {
  getContact,
  getConversation,
  listConversations,
  listMessages,
  searchContacts,
  sendReply,
  type ChatwootTools,
  type ToolResult,
} from "./tools";

const SERVER_VERSION = "0.1.0";

export function createScrmMcpServer(client: ChatwootTools): McpServer {
  const server = new McpServer(
    { name: "qymy-scrm", version: SERVER_VERSION },
    {
      instructions:
        "Internal Qymy Chatwoot SCRM tools. send_reply requires an existing conversation_id and cannot send by phone number. There are no delete, bulk-send, billing, or cross-account admin tools.",
    },
  );

  server.registerTool(
    "list_conversations",
    {
      description:
        "List Chatwoot conversations for one status. Returns id, status, inbox, contact summary, assignee, unread count, and updated_at. Page size is fixed upstream (default 25); limit truncates that page.",
      inputSchema: listConversationsInput,
    },
    async (input) => {
      logInfo("mcp_tool", { tool: "list_conversations", page: input.page, inbox_id: input.inbox_id ?? null });
      return toCallToolResult(await listConversations(client, input));
    },
  );

  server.registerTool(
    "get_conversation",
    {
      description:
        "Get one conversation by conversation_id, including contact summary, assignee, and the latest public message preview.",
      inputSchema: getConversationInput,
    },
    async (input) => {
      logInfo("mcp_tool", { tool: "get_conversation", conversation_id: input.conversation_id });
      return toCallToolResult(await getConversation(client, input));
    },
  );

  server.registerTool(
    "list_messages",
    {
      description:
        "List public messages in a conversation. Private notes and activity events are omitted. Use before with oldest_id to page backward. Do not pass before and after together.",
      inputSchema: listMessagesInput,
    },
    async (input) => {
      logInfo("mcp_tool", { tool: "list_messages", conversation_id: input.conversation_id });
      return toCallToolResult(await listMessages(client, input));
    },
  );

  server.registerTool(
    "send_reply",
    {
      description:
        "Send one outgoing reply or private note in an existing conversation. conversation_id is required. This tool cannot address a phone number, email, or contact id, and it cannot message more than one conversation.",
      inputSchema: sendReplyInput,
    },
    async (input) => {
      logInfo("mcp_tool", {
        tool: "send_reply",
        conversation_id: input.conversation_id,
        private: input.private,
      });
      const result = await sendReply(client, input);
      if (!result.ok) logError("mcp_tool_error", { tool: "send_reply", status: result.status ?? null });
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    "search_contacts",
    {
      description:
        "Search contacts by name, email, phone number, or identifier. Returns contact id, name, email, phone, and identifier.",
      inputSchema: searchContactsInput,
    },
    async (input) => {
      logInfo("mcp_tool", { tool: "search_contacts", q_length: input.q.length, page: input.page });
      return toCallToolResult(await searchContacts(client, input));
    },
  );

  server.registerTool(
    "get_contact",
    {
      description: "Get one contact by contact_id. Returns id, name, email, phone, identifier, and a short inbox list.",
      inputSchema: getContactInput,
    },
    async (input) => {
      logInfo("mcp_tool", { tool: "get_contact", contact_id: input.contact_id });
      return toCallToolResult(await getContact(client, input));
    },
  );

  return server;
}

function toCallToolResult(result: ToolResult): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  if (!result.ok) {
    return { isError: true, content: [{ type: "text", text: result.error }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
}

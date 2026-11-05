import { ChatwootError } from "../chatwoot/errors";
import {
  mapContactDetail,
  mapContactSearch,
  mapConversationDetail,
  mapConversationList,
  mapCreatedMessage,
  mapMessageList,
} from "../chatwoot/map";
import type { ChatwootClient } from "../chatwoot/client";
import type {
  GetContactInput,
  GetConversationInput,
  ListConversationsInput,
  ListMessagesInput,
  SearchContactsInput,
} from "./schemas";

export const SEND_REPLY_REQUIRES_CONVERSATION =
  "send_reply requires conversation_id. Refusing to send by phone number, email, or contact id alone.";

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string; status?: number };

export interface ChatwootTools {
  listConversations(query: {
    status: ListConversationsInput["status"];
    inboxId?: number;
    page: number;
  }): Promise<unknown>;
  getConversation(conversationId: number): Promise<unknown>;
  listMessages(conversationId: number, query: { before?: number; after?: number }): Promise<unknown>;
  createMessage(conversationId: number, body: { content: string; private: boolean }): Promise<unknown>;
  searchContacts(query: { q: string; page: number }): Promise<unknown>;
  getContact(contactId: number): Promise<unknown>;
}

export async function listConversations(client: ChatwootTools, input: ListConversationsInput): Promise<ToolResult> {
  return run(async () => {
    const raw = await client.listConversations({
      status: input.status,
      inboxId: input.inbox_id,
      page: input.page,
    });
    return mapConversationList(raw as Parameters<typeof mapConversationList>[0], input.page, input.limit);
  });
}

export async function getConversation(client: ChatwootTools, input: GetConversationInput): Promise<ToolResult> {
  return run(async () => mapConversationDetail((await client.getConversation(input.conversation_id)) as Parameters<typeof mapConversationDetail>[0]));
}

export async function listMessages(client: ChatwootTools, input: ListMessagesInput): Promise<ToolResult> {
  return run(async () => {
    const mode = input.after !== undefined ? "after" : input.before !== undefined ? "before" : "latest";
    const raw = await client.listMessages(input.conversation_id, {
      before: input.before,
      after: input.after,
    });
    return mapMessageList(raw as Parameters<typeof mapMessageList>[0], input.limit, mode);
  });
}

export async function sendReply(
  client: ChatwootTools,
  input: { conversation_id?: number | null; content?: string; private?: boolean },
): Promise<ToolResult> {
  if (!isConversationId(input.conversation_id)) {
    return { ok: false, error: SEND_REPLY_REQUIRES_CONVERSATION };
  }
  const content = input.content?.trim() ?? "";
  if (!content) return { ok: false, error: "send_reply requires non-empty content." };
  const isPrivate = input.private === true;
  return run(async () =>
    mapCreatedMessage(
      (await client.createMessage(input.conversation_id as number, {
        content,
        private: isPrivate,
      })) as Parameters<typeof mapCreatedMessage>[0],
    ),
  );
}

export async function searchContacts(client: ChatwootTools, input: SearchContactsInput): Promise<ToolResult> {
  return run(async () =>
    mapContactSearch(
      (await client.searchContacts({ q: input.q, page: input.page })) as Parameters<typeof mapContactSearch>[0],
      input.page,
    ),
  );
}

export async function getContact(client: ChatwootTools, input: GetContactInput): Promise<ToolResult> {
  return run(async () => mapContactDetail((await client.getContact(input.contact_id)) as Parameters<typeof mapContactDetail>[0]));
}

export function isConversationId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ChatwootError) {
      return { ok: false, error: error.message, status: error.status };
    }
    return { ok: false, error: "The tool failed before Chatwoot returned a result." };
  }
}

export function asChatwootTools(client: ChatwootClient): ChatwootTools {
  return client;
}

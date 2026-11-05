import { describe, expect, it, vi } from "vitest";
import { SEND_REPLY_REQUIRES_CONVERSATION, listConversations, listMessages, sendReply } from "../src/mcp/tools";
import type { ChatwootTools } from "../src/mcp/tools";

function tools(overrides: Partial<ChatwootTools> = {}): ChatwootTools {
  return {
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    listMessages: vi.fn(),
    createMessage: vi.fn(),
    searchContacts: vi.fn(),
    getContact: vi.fn(),
    ...overrides,
  };
}

describe("send_reply", () => {
  it("refuses to call Chatwoot without a conversation id", async () => {
    const client = tools();
    const missing = await sendReply(client, { content: "hello" });
    const phone = await sendReply(client, { conversation_id: null, content: "hello" });
    expect(missing).toEqual({ ok: false, error: SEND_REPLY_REQUIRES_CONVERSATION });
    expect(phone).toEqual({ ok: false, error: SEND_REPLY_REQUIRES_CONVERSATION });
    expect(client.createMessage).not.toHaveBeenCalled();
  });

  it("sends one outgoing message and returns ids only", async () => {
    const client = tools({
      createMessage: vi.fn().mockResolvedValue({
        id: 99,
        conversation_id: 7,
        content: "full reply body that must not be returned",
        private: false,
        created_at: 1_730_000_000,
      }),
    });
    const result = await sendReply(client, { conversation_id: 7, content: "hello", private: false });
    expect(client.createMessage).toHaveBeenCalledWith(7, { content: "hello", private: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ id: 99, conversation_id: 7, private: false });
      expect(JSON.stringify(result.data)).not.toContain("full reply body");
    }
  });
});

describe("list tools", () => {
  it("keeps conversation payloads compact and drops token-like assignee fields", async () => {
    const client = tools({
      listConversations: vi.fn().mockResolvedValue({
        data: {
          meta: { mine_count: 1, assigned_count: 1, unassigned_count: 0, all_count: 1 },
          payload: [
            {
              id: 42,
              status: "open",
              inbox_id: 7,
              unread_count: 2,
              updated_at: 1_730_000_000,
              meta: {
                sender: {
                  id: 9,
                  name: "Ada",
                  email: "ada@example.com",
                  phone_number: "+15550001111",
                  identifier: "ada-1",
                },
                assignee: { id: 3, name: "Agent", available_name: "Agent A", access_token: "should-not-leak" },
                channel: "Channel::Api",
              },
              messages: [{ id: 1, content: "secret body" }],
            },
          ],
        },
      }),
    });
    const result = await listConversations(client, { status: "open", page: 1, limit: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const encoded = JSON.stringify(result.data);
      expect(encoded).not.toContain("should-not-leak");
      expect(encoded).not.toContain("secret body");
      expect(result.data).toMatchObject({
        conversations: [
          {
            id: 42,
            status: "open",
            inbox: { id: 7, channel: "Channel::Api" },
            contact: { id: 9, name: "Ada", email: "ada@example.com" },
            assignee: { id: 3, name: "Agent A" },
            unread: 2,
          },
        ],
      });
    }
  });

  it("drops private notes from message lists", async () => {
    const client = tools({
      listMessages: vi.fn().mockResolvedValue({
        payload: [
          { id: 1, content: "public", message_type: 0, private: false, created_at: 1_730_000_000, sender: { id: 9, name: "Ada", type: "contact" } },
          { id: 2, content: "internal note", message_type: 1, private: true, created_at: 1_730_000_100 },
        ],
      }),
    });
    const result = await listMessages(client, { conversation_id: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result.data)).not.toContain("internal note");
      expect(result.data).toMatchObject({ returned: 1, messages: [{ id: 1, content: "public", message_type: "incoming" }] });
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  getContactInput,
  getConversationInput,
  listConversationsInput,
  listMessagesInput,
  searchContactsInput,
  sendReplyInput,
} from "../src/mcp/schemas";

describe("tool input schemas", () => {
  it("defaults conversation list filters and rejects unknown status", () => {
    expect(listConversationsInput.parse({})).toEqual({ status: "open", page: 1 });
    expect(listConversationsInput.safeParse({ status: "all" }).success).toBe(false);
    expect(listConversationsInput.safeParse({ inbox_id: 0 }).success).toBe(false);
    expect(listConversationsInput.safeParse({ limit: 26 }).success).toBe(false);
  });

  it("requires ids for conversation, contact, and search", () => {
    expect(getConversationInput.safeParse({}).success).toBe(false);
    expect(getConversationInput.safeParse({ conversation_id: 15 }).success).toBe(true);
    expect(getContactInput.safeParse({ contact_id: "4" }).success).toBe(false);
    expect(searchContactsInput.safeParse({ q: "   " }).success).toBe(false);
    expect(searchContactsInput.parse({ q: " ada " })).toEqual({ q: "ada", page: 1 });
  });

  it("refuses send_reply without conversation_id or with a phone field", () => {
    expect(sendReplyInput.safeParse({ content: "hello" }).success).toBe(false);
    expect(sendReplyInput.safeParse({ conversation_id: null, content: "hello" }).success).toBe(false);
    expect(sendReplyInput.safeParse({ phone_number: "+15550001111", content: "hello" }).success).toBe(false);
    expect(sendReplyInput.safeParse({ conversation_id: 9, content: "   " }).success).toBe(false);
    expect(sendReplyInput.parse({ conversation_id: 9, content: " hello " })).toEqual({
      conversation_id: 9,
      content: "hello",
      private: false,
    });
  });

  it("rejects paging messages both forward and backward", () => {
    expect(listMessagesInput.safeParse({ conversation_id: 4, before: 10, after: 2 }).success).toBe(false);
    expect(listMessagesInput.parse({ conversation_id: 4, before: 10, limit: 5 })).toMatchObject({
      conversation_id: 4,
      before: 10,
      limit: 5,
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatwootClient } from "../src/chatwoot/client";
import { ChatwootError } from "../src/chatwoot/errors";

const access = {
  baseUrl: "https://scrm.example.com",
  accountId: 12,
  accessToken: "chatwoot-test-token",
};

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

describe("ChatwootClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends api_access_token as a header and never in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { payload: [] } }));
    const client = new ChatwootClient(access, { fetch: fetchMock });
    await client.listConversations({ status: "open", page: 2, inboxId: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://scrm.example.com/api/v1/accounts/12/conversations?status=open&page=2&inbox_id=7");
    expect(url).not.toContain("chatwoot-test-token");
    const headers = new Headers(init.headers);
    expect(headers.get("api_access_token")).toBe("chatwoot-test-token");
    expect(init.redirect).toBe("manual");
  });

  it("retries once on 500 and does not retry 401", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const retryFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ id: 5, conversation_id: 9, private: true, created_at: 10 }));
    const client = new ChatwootClient(access, { fetch: retryFetch, sleep });
    const created = await client.createMessage(9, { content: "hello", private: true });
    expect(retryFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(created.id).toBe(5);
    const body = JSON.parse(String((retryFetch.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toEqual({
      content: "hello",
      message_type: "outgoing",
      private: true,
      content_type: "text",
    });

    const denied = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Invalid Access Token" }), { status: 401 }));
    const deniedClient = new ChatwootClient(access, { fetch: denied, sleep });
    await expect(deniedClient.getConversation(9)).rejects.toMatchObject({
      status: 401,
      kind: "unauthorized",
    } satisfies Partial<ChatwootError>);
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it("does not follow redirects with the token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example" } }));
    const client = new ChatwootClient(access, { fetch: fetchMock, sleep: async () => undefined });
    await expect(client.getContact(3)).rejects.toMatchObject({ kind: "redirect" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for public messages and surfaces 404 text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    const client = new ChatwootClient(access, { fetch: fetchMock, sleep: async () => undefined });
    await expect(client.listMessages(44, { before: 10 })).rejects.toThrow("Conversation 44 was not found (404).");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("filter_internal_messages=true");
    expect(url).toContain("before=10");
  });
});

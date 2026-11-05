import { logError } from "../log";
import { ChatwootError } from "./errors";
import type { ChatwootAccess } from "../auth";
import type {
  ChatwootContactList,
  ChatwootConversation,
  ChatwootConversationList,
  ChatwootMessage,
  ChatwootMessageList,
} from "./types";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_BODY_CHARS = 1_000_000;
const ERROR_DETAIL_CHARS = 180;

export interface ChatwootClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface ListConversationsQuery {
  status: "open" | "resolved" | "pending" | "snoozed";
  inboxId?: number;
  page: number;
}

export interface ListMessagesQuery {
  before?: number;
  after?: number;
}

export interface CreateMessageBody {
  content: string;
  private: boolean;
}

export interface SearchContactsQuery {
  q: string;
  page: number;
}

/**
 * Typed Application API wrapper for Chatwoot 4.19.1.
 * Auth is the `api_access_token` header (never a query parameter).
 * v4.19.1 also accepts Authorization: Bearer; see README.
 */
export class ChatwootClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(
    private readonly access: ChatwootAccess,
    options: ChatwootClientOptions = {},
  ) {
    // Keep global fetch's receiver. `const fetchImpl = fetch` throws "Illegal invocation" in workerd.
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleepImpl = options.sleep ?? defaultSleep;
  }

  listConversations(query: ListConversationsQuery): Promise<ChatwootConversationList> {
    return this.request({
      method: "GET",
      path: this.accountPath("/conversations"),
      query: {
        status: query.status,
        page: query.page,
        inbox_id: query.inboxId,
      },
    });
  }

  getConversation(conversationId: number): Promise<ChatwootConversation> {
    return this.request({
      method: "GET",
      path: this.accountPath(`/conversations/${conversationId}`),
      notFound: `Conversation ${conversationId} was not found`,
    });
  }

  listMessages(conversationId: number, query: ListMessagesQuery): Promise<ChatwootMessageList> {
    return this.request({
      method: "GET",
      path: this.accountPath(`/conversations/${conversationId}/messages`),
      query: {
        filter_internal_messages: true,
        before: query.before,
        after: query.after,
      },
      notFound: `Conversation ${conversationId} was not found`,
    });
  }

  createMessage(conversationId: number, body: CreateMessageBody): Promise<ChatwootMessage> {
    return this.request({
      method: "POST",
      path: this.accountPath(`/conversations/${conversationId}/messages`),
      body: {
        content: body.content,
        message_type: "outgoing",
        private: body.private,
        content_type: "text",
      },
      notFound: `Conversation ${conversationId} was not found`,
    });
  }

  searchContacts(query: SearchContactsQuery): Promise<ChatwootContactList> {
    return this.request({
      method: "GET",
      path: this.accountPath("/contacts/search"),
      query: { q: query.q, page: query.page, include_contact_inboxes: false },
    });
  }

  getContact(contactId: number): Promise<ChatwootContactList> {
    return this.request({
      method: "GET",
      path: this.accountPath(`/contacts/${contactId}`),
      notFound: `Contact ${contactId} was not found`,
    });
  }

  private accountPath(suffix: string): string {
    return `/api/v1/accounts/${this.access.accountId}${suffix}`;
  }

  private async request<T>(spec: {
    method: "GET" | "POST";
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    notFound?: string;
  }): Promise<T> {
    const url = this.buildUrl(spec.path, spec.query);
    const init = this.buildInit(spec.method, spec.body);
    let response = await this.send(url, init);
    if (RETRYABLE.has(response.status)) {
      await cancelBody(response);
      await this.sleepImpl(retryDelayMs(response));
      response = await this.send(url, init);
    }
    if (response.status >= 300 && response.status < 400) {
      await cancelBody(response);
      throw new ChatwootError(
        "Chatwoot redirected the request. Refusing to follow the redirect with the API token.",
        response.status,
        "redirect",
      );
    }
    if (!response.ok) throw await this.errorFromResponse(response, spec.notFound);
    return readJson<T>(response);
  }

  private buildUrl(path: string, query: Record<string, string | number | boolean | undefined> = {}): string {
    const url = new URL(path, this.access.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    for (const key of url.searchParams.keys()) {
      if (key.toLowerCase() === "api_access_token" || key.toLowerCase() === "access_token") {
        throw new ChatwootError("Refusing to send the Chatwoot token in the query string.", 0, "invalid");
      }
    }
    return url.toString();
  }

  private buildInit(method: "GET" | "POST", body: unknown): RequestInit {
    const headers = new Headers({
      accept: "application/json",
      api_access_token: this.access.accessToken,
    });
    const init: RequestInit = { method, headers, redirect: "manual" };
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(body);
    }
    return init;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      logError("chatwoot_network", { code: networkCode(error) });
      throw new ChatwootError("Could not reach Chatwoot.", 0, "network");
    }
  }

  private async errorFromResponse(response: Response, notFound?: string): Promise<ChatwootError> {
    const status = response.status;
    if (status === 401) {
      await cancelBody(response);
      return new ChatwootError(
        "Chatwoot rejected the API token (401). Check CHATWOOT_ACCESS_TOKEN.",
        401,
        "unauthorized",
      );
    }
    if (status === 403) {
      await cancelBody(response);
      return new ChatwootError(
        "Chatwoot denied this action (403). The API user lacks permission on this account.",
        403,
        "forbidden",
      );
    }
    if (status === 404) {
      await cancelBody(response);
      return new ChatwootError(notFound ? `${notFound} (404).` : "Chatwoot resource was not found (404).", 404, "not_found");
    }
    if (status === 429) {
      await cancelBody(response);
      return new ChatwootError("Chatwoot rate limited the request (429) after one retry.", 429, "rate_limited");
    }
    if (status >= 500) {
      await cancelBody(response);
      return new ChatwootError(
        `Chatwoot returned a server error (${status}) after one retry.`,
        status,
        "upstream",
      );
    }
    const detail = await safeErrorDetail(response, this.access.accessToken);
    const suffix = detail ? `: ${detail}` : ".";
    return new ChatwootError(`Chatwoot rejected the request (${status})${suffix}`, status, "invalid");
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.length > MAX_BODY_CHARS) {
    throw new ChatwootError("Chatwoot response was too large.", response.status, "upstream");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ChatwootError("Chatwoot returned invalid JSON.", response.status, "invalid");
  }
}

async function safeErrorDetail(response: Response, secret: string): Promise<string | null> {
  const text = await response.text();
  if (!text) return null;
  let detail = text.slice(0, 500);
  try {
    const parsed: unknown = JSON.parse(text);
    const extracted = extractErrorMessage(parsed);
    if (extracted) detail = extracted;
  } catch {
    // Keep the truncated text when the body is not JSON.
  }
  detail = detail.replaceAll(secret, "[redacted]").replace(/\s+/g, " ").trim();
  if (!detail) return null;
  return detail.length > ERROR_DETAIL_CHARS ? `${detail.slice(0, ERROR_DETAIL_CHARS)}…` : detail;
}

function extractErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  if (typeof record.description === "string") return record.description;
  if (Array.isArray(record.errors)) {
    const first = record.errors[0];
    if (first && typeof first === "object" && typeof (first as { message?: unknown }).message === "string") {
      return (first as { message: string }).message;
    }
  }
  return null;
}

function networkCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const cause = error.cause;
  if (cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return error.name;
}

function retryDelayMs(response: Response): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 2) return Math.round(seconds * 1000);
  }
  return 250;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be consumed or unsupported in the test mock.
  }
}

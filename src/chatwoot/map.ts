import { ChatwootError } from "./errors";
import type {
  ChatwootAssignee,
  ChatwootContactList,
  ChatwootContactSummary,
  ChatwootConversation,
  ChatwootConversationList,
  ChatwootMessage,
  ChatwootMessageList,
} from "./types";

const MESSAGE_PREVIEW_CHARS = 280;
const MESSAGE_LIST_CHARS = 1500;
const LABEL_LIMIT = 20;

export interface CompactContact {
  id: number;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  identifier: string | null;
}

export interface CompactAssignee {
  id: number;
  name: string | null;
}

export interface CompactConversation {
  id: number;
  status: string | null;
  inbox: { id: number | null; channel: string | null };
  contact: CompactContact | null;
  assignee: CompactAssignee | null;
  unread: number;
  updated_at: string | null;
}

export function mapConversationList(
  raw: ChatwootConversationList,
  page: number,
  limit: number | undefined,
): {
  page: number;
  returned: number;
  limit: number | null;
  page_note: string;
  counts: { mine: number; assigned: number; unassigned: number; all: number };
  conversations: CompactConversation[];
} {
  const payload = raw.data?.payload;
  if (!Array.isArray(payload)) {
    throw new ChatwootError("Chatwoot conversation list was missing data.payload.", 200, "invalid");
  }
  const mapped = payload.map(mapConversationSummary);
  const conversations = limit === undefined ? mapped : mapped.slice(0, limit);
  const meta = raw.data?.meta;
  return {
    page,
    returned: conversations.length,
    limit: limit ?? null,
    page_note:
      "Chatwoot pages this list with a fixed size (CONVERSATION_RESULTS_PER_PAGE, default 25). limit only truncates the current page.",
    counts: {
      mine: meta?.mine_count ?? 0,
      assigned: meta?.assigned_count ?? 0,
      unassigned: meta?.unassigned_count ?? 0,
      all: meta?.all_count ?? 0,
    },
    conversations,
  };
}

export function mapConversationDetail(raw: ChatwootConversation): Record<string, unknown> {
  const summary = mapConversationSummary(raw);
  const last = raw.last_non_activity_message;
  const lastPublic = last && last.private !== true ? mapMessage(last, MESSAGE_PREVIEW_CHARS) : null;
  return {
    ...summary,
    can_reply: raw.can_reply ?? null,
    priority: raw.priority ?? null,
    labels: Array.isArray(raw.labels) ? raw.labels.slice(0, LABEL_LIMIT) : [],
    created_at: unixToIso(raw.created_at),
    last_activity_at: unixToIso(raw.last_activity_at),
    snoozed_until: unixToIso(raw.snoozed_until),
    last_public_message: lastPublic,
  };
}

export function mapMessageList(
  raw: ChatwootMessageList,
  limit: number | undefined,
  mode: "latest" | "before" | "after",
): {
  returned: number;
  has_more: boolean;
  oldest_id: number | null;
  newest_id: number | null;
  next_before: number | null;
  messages: ReturnType<typeof mapMessage>[];
} {
  if (!Array.isArray(raw.payload)) {
    throw new ChatwootError("Chatwoot message list was missing payload.", 200, "invalid");
  }
  const cap = mode === "after" ? 100 : 20;
  const publicMessages = raw.payload.filter(isPublicMessage).map((message) => mapMessage(message, MESSAGE_LIST_CHARS));
  const messages = limit === undefined ? publicMessages : publicMessages.slice(-limit);
  const oldest = messages[0]?.id ?? null;
  const newest = messages[messages.length - 1]?.id ?? null;
  return {
    returned: messages.length,
    has_more: raw.payload.length >= cap || publicMessages.length > messages.length,
    oldest_id: oldest,
    newest_id: newest,
    next_before: oldest,
    messages,
  };
}

export function mapCreatedMessage(raw: ChatwootMessage): {
  id: number;
  conversation_id: number;
  private: boolean;
  created_at: string | null;
} {
  if (typeof raw.id !== "number" || typeof raw.conversation_id !== "number") {
    throw new ChatwootError("Chatwoot create-message response was missing ids.", 200, "invalid");
  }
  return {
    id: raw.id,
    conversation_id: raw.conversation_id,
    private: raw.private === true,
    created_at: unixToIso(raw.created_at),
  };
}

export function mapContactSearch(raw: ChatwootContactList, page: number): {
  page: number;
  count: number;
  has_more: boolean;
  contacts: CompactContact[];
} {
  const payload = Array.isArray(raw.payload) ? raw.payload : [];
  return {
    page,
    count: raw.meta?.count ?? payload.length,
    has_more: raw.meta?.has_more === true,
    contacts: payload.map(mapContact),
  };
}

export function mapContactDetail(raw: ChatwootContactList): Record<string, unknown> {
  const contact = !Array.isArray(raw.payload) && raw.payload ? raw.payload : null;
  if (!contact || typeof contact.id !== "number") {
    throw new ChatwootError("Chatwoot contact response was missing payload.id.", 200, "invalid");
  }
  const inboxes = Array.isArray(contact.contact_inboxes) ? contact.contact_inboxes : [];
  return {
    ...mapContact(contact),
    blocked: contact.blocked === true,
    last_activity_at: unixToIso(contact.last_activity_at),
    created_at: unixToIso(contact.created_at),
    inboxes: inboxes.slice(0, 10).map((entry) => ({
      id: entry.inbox?.id ?? null,
      name: entry.inbox?.name ?? null,
      channel_type: entry.inbox?.channel_type ?? null,
    })),
  };
}

function mapConversationSummary(raw: ChatwootConversation): CompactConversation {
  if (typeof raw.id !== "number") {
    throw new ChatwootError("Chatwoot conversation was missing id.", 200, "invalid");
  }
  return {
    id: raw.id,
    status: raw.status ?? null,
    inbox: {
      id: typeof raw.inbox_id === "number" ? raw.inbox_id : null,
      channel: raw.meta?.channel ?? null,
    },
    contact: raw.meta?.sender ? mapContact(raw.meta.sender) : null,
    assignee: mapAssignee(raw.meta?.assignee),
    unread: typeof raw.unread_count === "number" ? raw.unread_count : 0,
    updated_at: unixToIso(raw.updated_at),
  };
}

function mapContact(raw: ChatwootContactSummary): CompactContact {
  return {
    id: typeof raw.id === "number" ? raw.id : 0,
    name: textOrNull(raw.name),
    email: textOrNull(raw.email),
    phone_number: textOrNull(raw.phone_number),
    identifier: textOrNull(raw.identifier),
  };
}

function mapAssignee(raw: ChatwootAssignee | null | undefined): CompactAssignee | null {
  if (!raw || typeof raw.id !== "number") return null;
  return { id: raw.id, name: textOrNull(raw.available_name) ?? textOrNull(raw.name) };
}

function mapMessage(raw: ChatwootMessage, maxChars: number): {
  id: number;
  conversation_id: number | null;
  message_type: string;
  private: boolean;
  created_at: string | null;
  content: string | null;
  truncated: boolean;
  sender: { id: number | null; name: string | null; type: string | null };
  attachment_count: number;
} {
  const content = typeof raw.content === "string" ? raw.content : null;
  const truncated = content !== null && content.length > maxChars;
  return {
    id: typeof raw.id === "number" ? raw.id : 0,
    conversation_id: typeof raw.conversation_id === "number" ? raw.conversation_id : null,
    message_type: messageTypeName(raw.message_type),
    private: raw.private === true,
    created_at: unixToIso(raw.created_at),
    content: content === null ? null : truncated ? `${content.slice(0, maxChars)}…` : content,
    truncated,
    sender: {
      id: typeof raw.sender?.id === "number" ? raw.sender.id : null,
      name: textOrNull(raw.sender?.name),
      type: textOrNull(raw.sender?.type),
    },
    attachment_count: Array.isArray(raw.attachments) ? raw.attachments.length : 0,
  };
}

function isPublicMessage(message: ChatwootMessage): boolean {
  if (message.private === true) return false;
  const type = message.message_type;
  return type !== 2 && type !== "activity";
}

function messageTypeName(type: number | string | undefined): string {
  if (type === 0 || type === "incoming") return "incoming";
  if (type === 1 || type === "outgoing") return "outgoing";
  if (type === 2 || type === "activity") return "activity";
  if (type === 3 || type === "template") return "template";
  return "unknown";
}

function textOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unixToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const ms = value > 1e12 ? value : value * 1000;
  return new Date(ms).toISOString();
}

/** Minimal Chatwoot Application API fields this Worker reads. Extra fields are ignored. */

export interface ChatwootContactSummary {
  id?: number;
  name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  identifier?: string | null;
  blocked?: boolean;
  last_activity_at?: number | null;
  created_at?: number | null;
  contact_inboxes?: Array<{
    inbox?: {
      id?: number;
      name?: string;
      channel_type?: string;
    };
  }>;
}

export interface ChatwootAssignee {
  id?: number;
  name?: string | null;
  available_name?: string | null;
}

export interface ChatwootConversation {
  id?: number;
  status?: string;
  inbox_id?: number;
  unread_count?: number;
  updated_at?: number;
  created_at?: number;
  last_activity_at?: number;
  snoozed_until?: number | null;
  can_reply?: boolean;
  priority?: string | null;
  labels?: string[];
  meta?: {
    sender?: ChatwootContactSummary;
    assignee?: ChatwootAssignee | null;
    channel?: string;
    assignee_type?: string;
  };
  last_non_activity_message?: ChatwootMessage | null;
}

export interface ChatwootConversationList {
  data?: {
    meta?: {
      mine_count?: number;
      assigned_count?: number;
      unassigned_count?: number;
      all_count?: number;
    };
    payload?: ChatwootConversation[];
  };
}

export interface ChatwootMessage {
  id?: number;
  content?: string | null;
  conversation_id?: number;
  message_type?: number | string;
  private?: boolean;
  content_type?: string | null;
  created_at?: number;
  status?: string | null;
  sender?: {
    id?: number;
    name?: string | null;
    type?: string | null;
  } | null;
  attachments?: unknown[];
}

export interface ChatwootMessageList {
  payload?: ChatwootMessage[];
}

export interface ChatwootContactList {
  meta?: {
    count?: number;
    current_page?: number | string;
    has_more?: boolean;
  };
  payload?: ChatwootContactSummary[] | ChatwootContactSummary;
}

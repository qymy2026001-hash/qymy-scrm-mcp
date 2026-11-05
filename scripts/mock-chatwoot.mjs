/**
 * Local Chatwoot stand-in for `wrangler dev`. Not used in production.
 * Accepts any non-empty api_access_token header and returns fixture records.
 */
import { createServer } from "node:http";

const port = Number(process.env.MOCK_CHATWOOT_PORT ?? 4010);

const conversation = {
  id: 42,
  status: "open",
  inbox_id: 7,
  unread_count: 1,
  updated_at: 1730000000,
  created_at: 1720000000,
  last_activity_at: 1730000000,
  can_reply: true,
  priority: null,
  labels: ["demo"],
  meta: {
    sender: {
      id: 9,
      name: "Demo Contact",
      email: "demo@example.com",
      phone_number: "+15550001111",
      identifier: "demo-contact",
    },
    assignee: { id: 3, name: "Demo Agent", available_name: "Demo Agent" },
    channel: "Channel::Api",
  },
  last_non_activity_message: {
    id: 100,
    content: "Hello from the mock",
    conversation_id: 42,
    message_type: 0,
    private: false,
    created_at: 1730000000,
    sender: { id: 9, name: "Demo Contact", type: "contact" },
  },
};

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

const server = createServer((req, res) => {
  const token = req.headers["api_access_token"];
  if (typeof token !== "string" || token.length === 0) {
    send(res, 401, { error: "Invalid Access Token" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/v1/accounts/1/conversations") {
    send(res, 200, {
      data: {
        meta: { mine_count: 1, assigned_count: 1, unassigned_count: 0, all_count: 1 },
        payload: [conversation],
      },
    });
    return;
  }
  if (req.method === "GET" && path === "/api/v1/accounts/1/conversations/42") {
    send(res, 200, conversation);
    return;
  }
  if (req.method === "GET" && path === "/api/v1/accounts/1/conversations/42/messages") {
    send(res, 200, {
      payload: [
        conversation.last_non_activity_message,
        { id: 101, content: "private note", conversation_id: 42, message_type: 1, private: true, created_at: 1730000001 },
      ],
    });
    return;
  }
  if (req.method === "POST" && path === "/api/v1/accounts/1/conversations/42/messages") {
    send(res, 200, { id: 200, conversation_id: 42, private: false, created_at: 1730000002, content: "" });
    return;
  }
  if (req.method === "GET" && path === "/api/v1/accounts/1/contacts/search") {
    send(res, 200, {
      meta: { count: 1, current_page: 1, has_more: false },
      payload: [conversation.meta.sender],
    });
    return;
  }
  if (req.method === "GET" && path === "/api/v1/accounts/1/contacts/9") {
    send(res, 200, {
      payload: {
        ...conversation.meta.sender,
        blocked: false,
        contact_inboxes: [{ inbox: { id: 7, name: "Demo Inbox", channel_type: "Channel::Api" } }],
      },
    });
    return;
  }
  send(res, 404, { error: "not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ event: "mock_chatwoot_listening", port }));
});

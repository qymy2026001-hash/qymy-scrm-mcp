# qymy-scrm-mcp

Internal MCP server for Qymy’s self-hosted Chatwoot SCRM (v4.19.1). It runs as a stateless Cloudflare Worker and exposes a small set of Application API tools to Cursor and Claude. Phase P0 is single-tenant: one shared bearer token, one Chatwoot account. It is not a public product and it does not send bulk messages, delete records, or touch billing.

Do not merge this branch or deploy the Worker until the owner approves. This repository does not contain real secrets.

## Tools

| Tool | What it does |
| --- | --- |
| `list_conversations` | Filter by `open` / `resolved` / `pending` / `snoozed`, optional `inbox_id`, `page`, and `limit` |
| `get_conversation` | One conversation by `conversation_id`, with contact summary and the latest public message |
| `list_messages` | Public messages for a conversation. Private notes and activity events are omitted |
| `send_reply` | One outgoing reply, or a private note when `private` is true. **`conversation_id` is required.** There is no send-by-phone path |
| `search_contacts` | Search by name, email, phone, or identifier |
| `get_contact` | One contact by `contact_id` |

Chatwoot conversation ids in these tools are display ids (`/api/v1/accounts/{account_id}/conversations/{id}`), which is what the v4.19.1 API returns as `id`.

## Dependencies

Cloudflare’s handler API docs install `agents` with `@modelcontextprotocol/server@2.3.1`. That exact peer matches `agents@0.31.0` (the newest release that still pins 2.3.1). Newer Agents releases peer `@modelcontextprotocol/server@2.4.0`, so this repo stays on 0.31.0 until the docs and the peer move together. `@modelcontextprotocol/client@2.3.1` is installed because `agents@0.31.0` requires that peer. Zod is 4.6.7.

## Secrets

Set these as Worker secrets (`wrangler secret put`) or, for local dev only, in an untracked `.dev.vars` file. Names only:

| Name | Purpose |
| --- | --- |
| `MCP_ACCESS_TOKEN` | Bearer token clients must send on `/mcp` |
| `CHATWOOT_BASE_URL` | Chatwoot origin, for example `https://scrm.qymy.top`. No path and no token |
| `CHATWOOT_ACCESS_TOKEN` | Chatwoot user API token from Profile Settings |
| `CHATWOOT_ACCOUNT_ID` | Numeric account id used in `/api/v1/accounts/{account_id}/...` |

`CHATWOOT_ACCOUNT_ID` is required because every Application API route is account-scoped. It is a secret so the id is not committed and so a later per-tenant resolver can replace the whole credential bundle.

Copy `.dev.vars.example` to `.dev.vars` and replace the placeholders. `.dev.vars` is gitignored.

## Auth

MCP requests must send `Authorization: Bearer <MCP_ACCESS_TOKEN>`. The Worker hashes both values and compares them with `crypto.subtle.timingSafeEqual`. Tools never read `env`. They receive a `ChatwootClient` built from the resolved upstream access.

P0 uses `SharedBearerAuthResolver`. Replacing that resolver is the intended seam for portal-issued tenant tokens. Tool schemas and the Chatwoot client stay the same.

Upstream calls use Chatwoot’s `api_access_token` header, not a query parameter. That header is what `AccessTokenAuthHelper` in Chatwoot v4.19.1 reads. Chatwoot 4.19.0+ also accepts `Authorization: Bearer` for the same user token. Some reverse proxies drop headers that contain underscores unless `underscores_in_headers on` is set. If a valid token returns 401 from staging, check that proxy setting before rotating the token.

The Worker retries a Chatwoot call once on HTTP 429 or 5xx. It does not follow redirects. 401 and 403 become explicit tool errors and are not retried. Logs contain tool names, ids, and status codes. They do not contain tokens or message bodies.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm test
npm run typecheck
```

Mocked Chatwoot (no staging credentials):

```bash
npm run mock:chatwoot
```

In another shell, point `.dev.vars` at the mock (`CHATWOOT_BASE_URL=http://127.0.0.1:4010`, `CHATWOOT_ACCOUNT_ID=1`) and start the Worker:

```bash
npm run dev
```

`GET /` returns a short status document and does not require a token. `POST /mcp` without `Authorization: Bearer` returns 401.

Staging Chatwoot: put the real origin, user API token, and account id in `.dev.vars` (still untracked) and run `npm run dev`. Do not commit that file and do not run `wrangler deploy`.

## Connect Cursor or Claude Desktop

Remote MCP endpoint: `https://<worker-host>/mcp`

Cursor `mcp.json`:

```json
{
  "mcpServers": {
    "qymy-scrm": {
      "url": "https://<worker-host>/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_ACCESS_TOKEN>"
      }
    }
  }
}
```

Claude Desktop:

```json
{
  "mcpServers": {
    "qymy-scrm": {
      "type": "http",
      "url": "https://<worker-host>/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_ACCESS_TOKEN>"
      }
    }
  }
}
```

Replace `<worker-host>` and `<MCP_ACCESS_TOKEN>` locally. For `wrangler dev`, the URL is the local `/mcp` URL Wrangler prints (usually `http://localhost:8787/mcp`). A custom production hostname needs `allowedHostnames` on `createMcpHandler` before that host is used. The default handler allowlist covers localhost and `workers.dev`.

## Deploy

Deploy and merge only after the owner approves. This PR does not deploy the Worker and does not set production secrets.

## Roadmap

- **P1.** Assignment, labels, and conversation status changes. Still no delete and no bulk send.
- **P2.** Replace the shared bearer resolver with portal-issued per-tenant tokens. Each token resolves to that tenant’s Chatwoot base URL, account id, and access token. Tools stay on `ChatwootClient`.

import { timingSafeEqual } from "node:crypto";
import { logError } from "./log";

/**
 * Upstream Chatwoot credentials for a single authenticated MCP request.
 * P0 fills this from Worker secrets. A later portal resolver can return the
 * same shape per tenant without changing tools.
 */
export interface ChatwootAccess {
  baseUrl: string;
  accountId: number;
  accessToken: string;
}

export interface McpPrincipal {
  subject: string;
  authMethod: "shared_bearer";
  chatwoot: ChatwootAccess;
}

export interface SharedBearerSecrets {
  MCP_ACCESS_TOKEN?: string;
  CHATWOOT_BASE_URL?: string;
  CHATWOOT_ACCESS_TOKEN?: string;
  CHATWOOT_ACCOUNT_ID?: string;
}

export type AuthResolution =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; status: 401 | 500; message: string };

/**
 * Swap this resolver when portal-issued tenant tokens replace the shared bearer.
 * Tools receive a Chatwoot client built from `principal.chatwoot` and do not read secrets.
 */
export interface AuthResolver {
  resolve(request: Request, env: SharedBearerSecrets): Promise<AuthResolution>;
}

const BEARER = /^Bearer[ \t]+(\S+)\s*$/i;
const MAX_ACCOUNT_ID = 2_147_483_647;

export function readBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = BEARER.exec(header);
  const token = match?.[1];
  if (!token || token.includes("\n") || token.includes("\r")) return null;
  return token;
}

type SubtleWithTimingSafeEqual = SubtleCrypto & {
  timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean;
};

/** Hash both sides first so the compare does not leak length or prefix timing. */
export async function timingSafeEqualString(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  const subtleCompare = (crypto.subtle as SubtleWithTimingSafeEqual).timingSafeEqual;
  if (typeof subtleCompare === "function") {
    return subtleCompare.call(crypto.subtle, providedBytes, expectedBytes);
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}

export function parseChatwootBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localhost)) return null;
  return url.origin;
}

export function parseAccountId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id > MAX_ACCOUNT_ID) return null;
  return id;
}

export class SharedBearerAuthResolver implements AuthResolver {
  async resolve(request: Request, env: SharedBearerSecrets): Promise<AuthResolution> {
    const expected = env.MCP_ACCESS_TOKEN?.trim() ?? "";
    if (!expected) {
      logError("mcp_misconfigured", { missing: "MCP_ACCESS_TOKEN" });
      return { ok: false, status: 500, message: "MCP authentication is not configured" };
    }

    const provided = readBearerToken(request.headers.get("Authorization"));
    if (!provided) {
      return { ok: false, status: 401, message: "Unauthorized" };
    }

    const matches = await timingSafeEqualString(provided, expected);
    if (!matches) {
      return { ok: false, status: 401, message: "Unauthorized" };
    }

    const upstream = resolveSharedChatwootAccess(env);
    if (!upstream.ok) return upstream;
    return {
      ok: true,
      principal: {
        subject: "internal",
        authMethod: "shared_bearer",
        chatwoot: upstream.access,
      },
    };
  }
}

function resolveSharedChatwootAccess(
  env: SharedBearerSecrets,
): { ok: true; access: ChatwootAccess } | { ok: false; status: 500; message: string } {
  const baseRaw = env.CHATWOOT_BASE_URL?.trim() ?? "";
  const token = env.CHATWOOT_ACCESS_TOKEN?.trim() ?? "";
  const accountRaw = env.CHATWOOT_ACCOUNT_ID?.trim() ?? "";
  const missing = [
    !baseRaw ? "CHATWOOT_BASE_URL" : null,
    !token ? "CHATWOOT_ACCESS_TOKEN" : null,
    !accountRaw ? "CHATWOOT_ACCOUNT_ID" : null,
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    logError("mcp_misconfigured", { missing: missing.join(",") });
    return {
      ok: false,
      status: 500,
      message: `Chatwoot upstream is not configured. Missing ${missing.join(", ")}.`,
    };
  }

  const baseUrl = parseChatwootBaseUrl(baseRaw);
  if (!baseUrl) {
    logError("mcp_misconfigured", { invalid: "CHATWOOT_BASE_URL" });
    return {
      ok: false,
      status: 500,
      message: "CHATWOOT_BASE_URL must be an https origin (http only for localhost)",
    };
  }

  const accountId = parseAccountId(accountRaw);
  if (accountId === null) {
    logError("mcp_misconfigured", { invalid: "CHATWOOT_ACCOUNT_ID" });
    return {
      ok: false,
      status: 500,
      message: "CHATWOOT_ACCOUNT_ID must be a positive integer",
    };
  }

  return { ok: true, access: { baseUrl, accountId, accessToken: token } };
}

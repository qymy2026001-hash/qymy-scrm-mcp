import { describe, expect, it } from "vitest";
import {
  SharedBearerAuthResolver,
  parseAccountId,
  parseChatwootBaseUrl,
  readBearerToken,
  timingSafeEqualString,
  type SharedBearerSecrets,
} from "../src/auth";

const secrets: SharedBearerSecrets = {
  MCP_ACCESS_TOKEN: "mcp-test-token",
  CHATWOOT_BASE_URL: "https://scrm.example.com",
  CHATWOOT_ACCESS_TOKEN: "chatwoot-test-token",
  CHATWOOT_ACCOUNT_ID: "12",
};

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://worker.example/mcp", { method: "POST", headers });
}

describe("readBearerToken", () => {
  it("accepts a bearer token and rejects other schemes", () => {
    expect(readBearerToken("Bearer mcp-test-token")).toBe("mcp-test-token");
    expect(readBearerToken("bearer mcp-test-token")).toBe("mcp-test-token");
    expect(readBearerToken("Basic mcp-test-token")).toBeNull();
    expect(readBearerToken("Bearer")).toBeNull();
    expect(readBearerToken(null)).toBeNull();
  });
});

describe("timingSafeEqualString", () => {
  it("matches equal strings and rejects different lengths and prefixes", async () => {
    expect(await timingSafeEqualString("mcp-test-token", "mcp-test-token")).toBe(true);
    expect(await timingSafeEqualString("mcp-test-token", "mcp-test-tokex")).toBe(false);
    expect(await timingSafeEqualString("short", "mcp-test-token")).toBe(false);
    expect(await timingSafeEqualString("mcp-test-token-extra", "mcp-test-token")).toBe(false);
  });
});

describe("SharedBearerAuthResolver", () => {
  const resolver = new SharedBearerAuthResolver();

  it("rejects a missing or wrong bearer token", async () => {
    const missing = await resolver.resolve(request(), secrets);
    const wrong = await resolver.resolve(request("Bearer wrong-token"), secrets);
    expect(missing.ok).toBe(false);
    expect(wrong.ok).toBe(false);
    if (!missing.ok && !wrong.ok) {
      expect(missing.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(missing.message).not.toContain("mcp-test-token");
      expect(wrong.message).not.toContain("chatwoot-test-token");
    }
  });

  it("fails closed when the MCP secret is unset", async () => {
    const result = await resolver.resolve(request("Bearer mcp-test-token"), {
      ...secrets,
      MCP_ACCESS_TOKEN: " ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
  });

  it("returns upstream access without echoing secrets in the error path", async () => {
    const result = await resolver.resolve(request("Bearer mcp-test-token"), secrets);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.authMethod).toBe("shared_bearer");
      expect(result.principal.subject).toBe("internal");
      expect(result.principal.chatwoot).toEqual({
        baseUrl: "https://scrm.example.com",
        accountId: 12,
        accessToken: "chatwoot-test-token",
      });
    }
  });

  it("rejects a bearer match when Chatwoot settings are incomplete or unsafe", async () => {
    const missing = await resolver.resolve(request("Bearer mcp-test-token"), {
      ...secrets,
      CHATWOOT_ACCESS_TOKEN: undefined,
    });
    const queryUrl = await resolver.resolve(request("Bearer mcp-test-token"), {
      ...secrets,
      CHATWOOT_BASE_URL: "https://scrm.example.com/?token=secret",
    });
    const httpUrl = await resolver.resolve(request("Bearer mcp-test-token"), {
      ...secrets,
      CHATWOOT_BASE_URL: "http://scrm.example.com",
    });
    expect(missing.ok).toBe(false);
    expect(queryUrl.ok).toBe(false);
    expect(httpUrl.ok).toBe(false);
  });
});

describe("upstream parsing", () => {
  it("allows localhost http and rejects account ids that are not positive integers", () => {
    expect(parseChatwootBaseUrl("http://127.0.0.1:4010")).toBe("http://127.0.0.1:4010");
    expect(parseChatwootBaseUrl("https://scrm.example.com/api")).toBeNull();
    expect(parseAccountId("12")).toBe(12);
    expect(parseAccountId("0")).toBeNull();
    expect(parseAccountId("01")).toBeNull();
    expect(parseAccountId("nope")).toBeNull();
  });
});

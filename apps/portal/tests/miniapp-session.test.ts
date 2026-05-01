import test from "node:test";
import assert from "node:assert/strict";
import { issueHubAccessToken, verifyHubAccessToken } from "../lib/hub-auth";

test("miniapp токен короткоживущий и валидируется", () => {
  const prev = process.env.HUB_OIDC_SIGNING_SECRET;
  process.env.HUB_OIDC_SIGNING_SECRET = "miniapp-secret";
  const token = issueHubAccessToken({
    sub: "tg:42",
    source: "telegram-miniapp",
    scope: "agent-hub:control",
    ttlSec: 120,
  });
  const claims = verifyHubAccessToken(token);
  assert.ok(claims);
  assert.equal(claims?.source, "telegram-miniapp");
  assert.equal(claims?.scope, "agent-hub:control");
  if (prev === undefined) delete process.env.HUB_OIDC_SIGNING_SECRET;
  else process.env.HUB_OIDC_SIGNING_SECRET = prev;
});

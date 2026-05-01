import test from "node:test";
import assert from "node:assert/strict";
import {
  expectedSessionToken,
  hubPasswordOk,
  issueHubAccessToken,
  verifyHubAccessToken,
  verifyHubSession,
  verifyTelegramInitData,
} from "../lib/hub-auth";
import { createHmac } from "node:crypto";

test("expectedSessionToken возвращает пустую строку без секрета", () => {
  const prev = process.env.HUB_SESSION_SECRET;
  delete process.env.HUB_SESSION_SECRET;

  assert.equal(expectedSessionToken(), "");

  if (prev === undefined) {
    delete process.env.HUB_SESSION_SECRET;
  } else {
    process.env.HUB_SESSION_SECRET = prev;
  }
});

test("expectedSessionToken детерминирован и verifyHubSession валидирует токен", () => {
  const prev = process.env.HUB_SESSION_SECRET;
  process.env.HUB_SESSION_SECRET = "super-secret";

  const tokenA = expectedSessionToken();
  const tokenB = expectedSessionToken();

  assert.equal(tokenA, tokenB);
  assert.notEqual(tokenA, "");
  assert.equal(verifyHubSession(tokenA), true);
  assert.equal(verifyHubSession("wrong-token"), false);
  assert.equal(verifyHubSession(undefined), false);

  if (prev === undefined) {
    delete process.env.HUB_SESSION_SECRET;
  } else {
    process.env.HUB_SESSION_SECRET = prev;
  }
});

test("hubPasswordOk сравнивает пароль безопасно и учитывает пустые значения", () => {
  const prev = process.env.HUB_PASSWORD;
  process.env.HUB_PASSWORD = "p@ssw0rd";

  assert.equal(hubPasswordOk("p@ssw0rd"), true);
  assert.equal(hubPasswordOk("p@ssw0rd!"), false);
  assert.equal(hubPasswordOk(""), false);

  delete process.env.HUB_PASSWORD;
  assert.equal(hubPasswordOk("p@ssw0rd"), false);

  if (prev === undefined) {
    delete process.env.HUB_PASSWORD;
  } else {
    process.env.HUB_PASSWORD = prev;
  }
});

test("issueHubAccessToken/verifyHubAccessToken создают и валидируют токен", () => {
  const prevSecret = process.env.HUB_OIDC_SIGNING_SECRET;
  process.env.HUB_OIDC_SIGNING_SECRET = "oidc-secret";

  const token = issueHubAccessToken({ sub: "tg:1", source: "telegram-miniapp", ttlSec: 120 });
  assert.notEqual(token, "");
  const claims = verifyHubAccessToken(token);
  assert.ok(claims);
  assert.equal(claims?.sub, "tg:1");

  if (prevSecret === undefined) delete process.env.HUB_OIDC_SIGNING_SECRET;
  else process.env.HUB_OIDC_SIGNING_SECRET = prevSecret;
});

test("verifyTelegramInitData проверяет hash и user", () => {
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "123456:ABCDEF_test_token";

  const authDate = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: 77, first_name: "Test" });
  const fields = [`auth_date=${authDate}`, `query_id=q1`, `user=${user}`].sort().join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(fields).digest("hex");
  const initData = `query_id=q1&user=${encodeURIComponent(user)}&auth_date=${authDate}&hash=${hash}`;

  const verified = verifyTelegramInitData(initData);
  assert.equal(verified.ok, true);
  assert.equal(verified.userId, "77");

  if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prevToken;
});

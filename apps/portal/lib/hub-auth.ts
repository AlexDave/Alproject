import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE = "hub_session";
const ACCESS_COOKIE = "hub_access";
const TELEGRAM_SKEW_SEC = Number.parseInt(process.env.HUB_TELEGRAM_MAX_AGE_SEC ?? "300", 10);

type JwtClaims = {
  sub: string;
  scope: string;
  source?: "telegram-miniapp" | "legacy";
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
};

function sessionSecret(): string {
  return process.env.HUB_SESSION_SECRET ?? "";
}

/** Детерминированный токен сессии (без серверного хранилища). */
export function expectedSessionToken(): string {
  const s = sessionSecret();
  if (!s) return "";
  return createHmac("sha256", s).update("alproject:hub-session:v1").digest("base64url");
}

export function verifyHubSession(token: string | undefined): boolean {
  const exp = expectedSessionToken();
  if (!token || !exp) return false;
  try {
    const a = Buffer.from(token, "utf8");
    const b = Buffer.from(exp, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function readHubSessionFromCookies(): Promise<boolean> {
  const c = await cookies();
  return verifyHubSession(c.get(COOKIE)?.value);
}

export function hubPasswordOk(pw: string): boolean {
  const expected = process.env.HUB_PASSWORD ?? "";
  if (!expected || !pw) return false;
  try {
    const a = Buffer.from(pw, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const HUB_SESSION_COOKIE_NAME = COOKIE;
export const HUB_ACCESS_COOKIE_NAME = ACCESS_COOKIE;

/** Без HTTPS (Docker/Kubernetes по HTTP) браузеры не принимают Secure-cookies — выставите HUB_COOKIE_SECURE=false. */
export function hubCookieSecure(): boolean {
  const v = process.env.HUB_COOKIE_SECURE;
  if (v === "false" || v === "0") return false;
  if (v === "true" || v === "1") return true;
  return process.env.NODE_ENV === "production";
}

function accessSecret(): string {
  return process.env.HUB_OIDC_SIGNING_SECRET ?? "";
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeB64urlJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function issueHubAccessToken(input: {
  sub: string;
  scope?: string;
  source?: "telegram-miniapp" | "legacy";
  ttlSec?: number;
}): string {
  const secret = accessSecret();
  if (!secret) return "";
  const now = Math.floor(Date.now() / 1000);
  const ttlSec = Math.max(60, Math.min(60 * 60 * 24, input.ttlSec ?? 15 * 60));
  const payload: JwtClaims = {
    sub: input.sub,
    scope: input.scope ?? "agent-hub:control",
    source: input.source ?? "legacy",
    iat: now,
    exp: now + ttlSec,
    iss: process.env.HUB_OIDC_ISSUER ?? "alproject-portal",
    aud: process.env.HUB_OIDC_AUDIENCE ?? "agent-hub-miniapp",
  };
  const head = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson(payload);
  const sig = sign(`${head}.${body}`, secret);
  return `${head}.${body}.${sig}`;
}

/** Заголовок Cookie для случаев, когда `cookies()` из next/headers не совпадает с запросом (SSE/EventSource). */
function cookiesFromHeader(cookieHeader: string | null): Map<string, string> {
  const m = new Map<string, string>();
  if (!cookieHeader?.trim()) return m;
  for (const segment of cookieHeader.split(";")) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const name = segment.slice(0, eq).trim();
    let val = segment.slice(eq + 1).trim();
    try {
      val = decodeURIComponent(val);
    } catch {
      /* оставляем как есть */
    }
    if (name) m.set(name, val);
  }
  return m;
}

export function verifyHubAccessToken(token: string | undefined): JwtClaims | null {
  const secret = accessSecret();
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expectedSig = sign(`${head}.${body}`, secret);
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const claims = decodeB64urlJson<JwtClaims>(body);
  if (!claims) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) return null;
  if (claims.iss && process.env.HUB_OIDC_ISSUER && claims.iss !== process.env.HUB_OIDC_ISSUER) return null;
  if (claims.aud && process.env.HUB_OIDC_AUDIENCE && claims.aud !== process.env.HUB_OIDC_AUDIENCE) return null;
  return claims;
}

export async function readHubAuthFromRequest(req?: Request): Promise<{
  ok: boolean;
  sub?: string;
  scope?: string;
  source?: string;
}> {
  if (req) {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const claims = verifyHubAccessToken(token);
    if (claims) {
      return { ok: true, sub: claims.sub, scope: claims.scope, source: claims.source };
    }
  }
  const c = await cookies();
  const fromHeader = req ? cookiesFromHeader(req.headers.get("cookie")) : null;
  const accessRaw =
    c.get(HUB_ACCESS_COOKIE_NAME)?.value ?? fromHeader?.get(HUB_ACCESS_COOKIE_NAME);
  const accessClaims = verifyHubAccessToken(accessRaw);
  if (accessClaims) {
    return { ok: true, sub: accessClaims.sub, scope: accessClaims.scope, source: accessClaims.source };
  }
  const sessionRaw = c.get(HUB_SESSION_COOKIE_NAME)?.value ?? fromHeader?.get(HUB_SESSION_COOKIE_NAME);
  if (verifyHubSession(sessionRaw)) {
    return { ok: true, source: "legacy-cookie" };
  }
  return { ok: false };
}

function parseTelegramInitData(raw: string): URLSearchParams {
  return new URLSearchParams(raw);
}

export function verifyTelegramInitData(initDataRaw: string): { ok: boolean; userId?: string; reason?: string } {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!botToken) return { ok: false, reason: "TELEGRAM_BOT_TOKEN missing" };
  const params = parseTelegramInitData(initDataRaw);
  const hash = params.get("hash") ?? "";
  if (!hash) return { ok: false, reason: "hash missing" };

  const pairs: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computed !== hash) return { ok: false, reason: "hash mismatch" };

  const authDate = Number.parseInt(params.get("auth_date") ?? "", 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || Math.abs(nowSec - authDate) > TELEGRAM_SKEW_SEC) {
    return { ok: false, reason: "auth_date expired" };
  }

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "user missing" };
  try {
    const user = JSON.parse(userRaw) as { id?: number | string };
    const userId = String(user.id ?? "").trim();
    if (!userId) return { ok: false, reason: "user.id missing" };
    const allow = (process.env.HUB_TELEGRAM_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (allow.length > 0 && !allow.includes(userId)) {
      return { ok: false, reason: "user not allowed" };
    }
    return { ok: true, userId };
  } catch {
    return { ok: false, reason: "invalid user payload" };
  }
}

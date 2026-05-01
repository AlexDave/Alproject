import { NextResponse } from "next/server";
import { z } from "zod";
import {
  expectedSessionToken,
  hubCookieSecure,
  hubPasswordOk,
  HUB_ACCESS_COOKIE_NAME,
  HUB_SESSION_COOKIE_NAME,
  issueHubAccessToken,
} from "@/lib/hub-auth";

const schema = z.object({
  password: z.string().min(1),
});

export async function POST(req: Request) {
  if (!process.env.HUB_PASSWORD || !process.env.HUB_SESSION_SECRET) {
    return NextResponse.json({ error: "Hub не настроен (HUB_PASSWORD / HUB_SESSION_SECRET)" }, { status: 503 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Нужен password" }, { status: 400 });
  }

  if (!hubPasswordOk(parsed.data.password)) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  const token = expectedSessionToken();
  const accessToken = issueHubAccessToken({
    sub: "legacy:password-user",
    scope: "agent-hub:control",
    source: "legacy",
    ttlSec: Number.parseInt(process.env.HUB_OIDC_TTL_SEC ?? "900", 10),
  });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(HUB_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: hubCookieSecure(),
  });
  if (accessToken) {
    res.cookies.set(HUB_ACCESS_COOKIE_NAME, accessToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: Number.parseInt(process.env.HUB_OIDC_TTL_SEC ?? "900", 10),
      secure: hubCookieSecure(),
    });
  }
  return res;
}

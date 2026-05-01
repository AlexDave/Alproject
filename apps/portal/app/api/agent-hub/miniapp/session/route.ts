import { NextResponse } from "next/server";
import { z } from "zod";
import {
  HUB_ACCESS_COOKIE_NAME,
  hubCookieSecure,
  issueHubAccessToken,
  verifyTelegramInitData,
} from "@/lib/hub-auth";

const schema = z.object({
  initData: z.string().min(1),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "initData is required" }, { status: 400 });
  }

  const check = verifyTelegramInitData(parsed.data.initData);
  if (!check.ok || !check.userId) {
    return NextResponse.json({ error: check.reason ?? "Unauthorized" }, { status: 401 });
  }

  const token = issueHubAccessToken({
    sub: `tg:${check.userId}`,
    source: "telegram-miniapp",
    scope: "agent-hub:control",
    ttlSec: Number.parseInt(process.env.HUB_OIDC_TTL_SEC ?? "900", 10),
  });
  if (!token) {
    return NextResponse.json({ error: "HUB_OIDC_SIGNING_SECRET missing" }, { status: 503 });
  }

  const res = NextResponse.json({ ok: true, accessToken: token, expiresIn: Number.parseInt(process.env.HUB_OIDC_TTL_SEC ?? "900", 10) });
  res.cookies.set(HUB_ACCESS_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Number.parseInt(process.env.HUB_OIDC_TTL_SEC ?? "900", 10),
    secure: hubCookieSecure(),
  });
  return res;
}

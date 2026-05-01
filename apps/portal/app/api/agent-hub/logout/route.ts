import { NextResponse } from "next/server";
import { HUB_ACCESS_COOKIE_NAME, HUB_SESSION_COOKIE_NAME } from "@/lib/hub-auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(HUB_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  res.cookies.set(HUB_ACCESS_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}

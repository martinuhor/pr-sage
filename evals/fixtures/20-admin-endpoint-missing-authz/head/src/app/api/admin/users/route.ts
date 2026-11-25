import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const users = await db.query(
    "SELECT id, email, role FROM users ORDER BY created_at DESC"
  );
  return NextResponse.json({ users });
}

export function loginRedirect(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");
  const target = new URL(next ?? "/dashboard", request.url);
  return NextResponse.redirect(target);
}

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const correct = process.env.ADVISOR_PASSWORD;

  if (!correct) {
    return NextResponse.json({ error: "Server misconfigured: ADVISOR_PASSWORD not set" }, { status: 500 });
  }

  if (password !== correct) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}

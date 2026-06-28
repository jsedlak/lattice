import { createConversation, listConversations } from "@lattice/db";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const conversations = await listConversations(user.id);
  return NextResponse.json({ conversations });
}

export async function POST() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const conversation = await createConversation(user.id);
  return NextResponse.json({ conversation }, { status: 201 });
}

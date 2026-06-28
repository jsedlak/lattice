import {
  deleteConversation,
  getConversation,
  getMessages,
  renameConversation,
  setConversationModel,
} from "@lattice/db";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const conversation = await getConversation(user.id, id);
  if (!conversation) return new Response("Not found", { status: 404 });
  const messages = await getMessages(user.id, id);
  return NextResponse.json({ conversation, messages });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { title?: string; model?: string };

  let conversation = null;
  if (typeof body.title === "string") conversation = await renameConversation(user.id, id, body.title);
  if (body.model) conversation = await setConversationModel(user.id, id, body.model);
  if (conversation === null) return new Response("Not found", { status: 404 });
  return NextResponse.json({ conversation });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const deleted = await deleteConversation(user.id, id);
  if (!deleted) return new Response("Not found", { status: 404 });
  return NextResponse.json({ ok: true });
}

import { deleteFolder, renameFolder } from "@lattice/db";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/session";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const folder = await renameFolder(user.id, id, body.name ?? "Untitled");
  if (!folder) return new Response("Not found", { status: 404 });
  return NextResponse.json({ folder });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const ok = await deleteFolder(user.id, id);
  if (!ok) return new Response("Not found", { status: 404 });
  return NextResponse.json({ ok: true });
}

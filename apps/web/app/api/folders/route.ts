import { createFolder, listFolders } from "@lattice/db";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const folders = await listFolders(user.id);
  return NextResponse.json({ folders });
}

export async function POST(req: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const body = (await req.json().catch(() => ({}))) as { name?: string; parentId?: string | null };
  const folder = await createFolder(user.id, body.name?.trim() || "New folder", body.parentId ?? null);
  return NextResponse.json({ folder }, { status: 201 });
}

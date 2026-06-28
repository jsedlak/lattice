import { getGraph, type NodeType } from "@lattice/db";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/session";

export const runtime = "nodejs";

const VALID_TYPES: NodeType[] = ["document", "tag", "entity"];

export async function GET(req: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { searchParams } = new URL(req.url);
  const typesParam = searchParams.get("types");
  const types = typesParam
    ? (typesParam.split(",").filter((t): t is NodeType => VALID_TYPES.includes(t as NodeType)))
    : undefined;
  const originParam = searchParams.get("origin");
  const origin =
    originParam === "deterministic" || originParam === "llm" ? originParam : undefined;

  const data = await getGraph(user.id, { types, origin });
  return NextResponse.json(data);
}

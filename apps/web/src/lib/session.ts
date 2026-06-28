import "server-only";
import { getUserFromHeaders, type SessionUser } from "@lattice/auth/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/** The signed-in user, or null. */
export async function getUser(): Promise<SessionUser | null> {
  return getUserFromHeaders(await headers());
}

/** For server components / pages: redirect to sign-in if unauthenticated. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** For route handlers: return the user or a 401 Response. Usage:
 *    const user = await requireApiUser();
 *    if (user instanceof Response) return user;            */
export async function requireApiUser(): Promise<SessionUser | Response> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  return user;
}

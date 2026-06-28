import { auth } from "@lattice/auth/server";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);

export const runtime = "nodejs";

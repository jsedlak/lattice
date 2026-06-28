import { type NextRequest, NextResponse } from "next/server";

/**
 * Coarse redirect-to-login for app routes. This is a CONVENIENCE only — the
 * authorization boundary is each route handler / server component calling
 * requireUser()/requireApiUser(). We only check for the presence of the session
 * cookie here; we never trust it for authorization.
 */
const SESSION_COOKIES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

export function middleware(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Run on app pages, not on auth pages, api, or static assets.
  matcher: [
    "/",
    "/editor/:path*",
    "/graph/:path*",
    "/assistant/:path*",
    "/documents/:path*",
  ],
};

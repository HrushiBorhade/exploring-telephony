import { type NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  // Already logged in → skip the login page
  if (pathname === "/login" && sessionCookie) {
    return NextResponse.redirect(new URL("/capture", request.url));
  }

  // Not logged in → redirect to login
  if (
    (pathname.startsWith("/capture") || pathname.startsWith("/settings") || pathname.startsWith("/onboarding") || pathname.startsWith("/auth-callback")) &&
    !sessionCookie
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/capture/:path*", "/settings", "/onboarding", "/auth-callback"],
};

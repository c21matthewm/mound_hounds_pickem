import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv } from "./src/lib/supabase/env";

const AUTH_ROUTE_PREFIXES = ["/login", "/signup"];
const PROTECTED_ROUTE_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/picks",
  "/leaderboard",
  "/admin",
  "/feedback"
];

const startsWithPrefix = (pathname: string, prefixes: string[]): boolean =>
  prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export async function middleware(request: NextRequest) {
  let anonKey: string;
  let url: string;
  try {
    ({ anonKey, url } = getSupabaseEnv());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Missing Supabase environment variables in deployment settings.";
    return new NextResponse(`Deployment configuration error: ${message}`, {
      headers: { "content-type": "text/plain; charset=utf-8" },
      status: 500
    });
  }

  let response = NextResponse.next({
    request
  });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request
        });

        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = startsWithPrefix(pathname, AUTH_ROUTE_PREFIXES);
  const isProtectedRoute = startsWithPrefix(pathname, PROTECTED_ROUTE_PREFIXES);

  if (!user && isProtectedRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (user && isAuthRoute) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/onboarding";
    destination.search = "";
    return NextResponse.redirect(destination);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};

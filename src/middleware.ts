import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/core/supabase/env";
import { withTimeout } from "@/core/supabase/safe-query";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptionsWithName;
}

async function resolveUser(supabase: SupabaseClient): Promise<User | null> {
  try {
    const user = await withTimeout(
      supabase.auth.getUser().then(({ data }) => data.user ?? null),
      null
    );
    if (user) return user;
  } catch {
    void 0;
  }

  try {
    const session = await withTimeout(
      supabase.auth.getSession().then(({ data }) => data.session ?? null),
      null
    );
    return session?.user ?? null;
  } catch {
    return null;
  }
}

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/sales",
  "/pos",
  "/products",
  "/purchases",
  "/debts",
  "/expenses",
  "/accounts",
  "/contacts",
  "/reports",
  "/settings",
  "/admin"
];

const AUTH_PAGES = ["/login", "/register"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function middleware(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      }
    }
  });

  const user = await resolveUser(supabase);

  const { pathname } = request.nextUrl;

  if (!user && isProtected(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/register",
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/sales/:path*",
    "/pos/:path*",
    "/products/:path*",
    "/purchases/:path*",
    "/debts/:path*",
    "/expenses/:path*",
    "/accounts/:path*",
    "/contacts/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/admin/:path*"
  ]
};

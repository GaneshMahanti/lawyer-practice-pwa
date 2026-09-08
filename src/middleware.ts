import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * VakilDesk Route Enforcement Middleware.
 *
 * PUBLIC routes (no auth required):
 *   /login
 *   /portal/[token]          — client KYC portal
 *   /api/portal/*            — portal submission API
 *   /api/translate           — translation (server-side, no sensitive data returned)
 *   /access-denied
 *   /icons/*, /manifest.json, /sw.js, /_next/*, /favicon*
 *
 * PROTECTED routes (/app/*):
 *   Require a valid Supabase session with role = 'developer' | 'lawyer'.
 *   Any other session (no user, unknown role) → redirect /login.
 *   Clients have no accounts and therefore can never reach /app/*.
 */

const PUBLIC_PATHS = [
  '/login',
  '/access-denied',
  '/portal',
  '/api/portal',
  '/api/translate',
];

const STATIC_PREFIXES = [
  '/_next/',
  '/icons/',
  '/favicon',
  '/manifest.json',
  '/sw.js',
  '/logo-',
];

function isPublic(pathname: string): boolean {
  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Root redirect → /app (middleware handles auth check there)
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/app', request.url));
  }

  // Public routes pass through without any auth check
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // All /app/* routes require authentication
  if (pathname.startsWith('/app')) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

    const response = NextResponse.next({
      request: { headers: request.headers },
    });

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    // Local dev fallback when Supabase keys are not configured yet
    const isLocalPlaceholder =
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://placeholder.supabase.co';

    if (isLocalPlaceholder) {
      const devCookie = request.cookies.get('vakildesk_dev_session')?.value;
      if (devCookie) {
        try {
          const parsed = JSON.parse(decodeURIComponent(devCookie));
          if (parsed.role === 'developer' || parsed.role === 'lawyer') {
            if (parsed.role === 'lawyer' && pathname.startsWith('/app/admin')) {
              return NextResponse.redirect(new URL('/access-denied', request.url));
            }
            return response;
          }
        } catch {}
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // getUser() validates the JWT server-side — cannot be spoofed by client
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }

    const role = user.app_metadata?.role as string | undefined;

    // Clients have no accounts — this is a belt-and-suspenders check
    if (role !== 'developer' && role !== 'lawyer') {
      return NextResponse.redirect(new URL('/access-denied', request.url));
    }

    // Lawyers cannot access /app/admin/* (developer-only)
    if (role === 'lawyer' && pathname.startsWith('/app/admin')) {
      return NextResponse.redirect(new URL('/access-denied', request.url));
    }

    return response;
  }

  // Any unrecognised non-public path → redirect to /app
  return NextResponse.redirect(new URL('/app', request.url));
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

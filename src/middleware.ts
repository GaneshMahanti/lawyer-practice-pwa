import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * VakilDesk Route Enforcement Middleware.
 *
 * PUBLIC routes (no auth required):
 *   /login
 *   /auth/callback           — PKCE code exchange
 *   /portal/[token]          — client KYC portal (isolated)
 *   /api/portal/*            — portal submission API
 *   /api/translate           — translation
 *   /access-denied
 *   /icons/*, /manifest.json, /sw.js, /_next/*, /favicon*
 *
 * PROTECTED routes (/app/*):
 *   Requires a valid server-side session with role = 'developer' | 'lawyer'.
 *   - 'developer': full access to /app/* and /app/admin/*; onboarding bypassed.
 *   - 'lawyer': access to /app/*; denied /app/admin/*; redirected to /app/onboarding if incomplete.
 *   - unapproved Google accounts or clients: redirected to /access-denied.
 */

const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
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
    const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'placeholder-publishable-key';

    const response = NextResponse.next({
      request: { headers: request.headers },
    });

    // Check for dev session cookie (used for local credentials testing when live Supabase is offline)
    const isLocalPlaceholder =
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://placeholder.supabase.co';

    if (isLocalPlaceholder) {
      const devCookie = request.cookies.get('vakildesk_dev_session')?.value;
      if (devCookie) {
        try {
          const parsed = JSON.parse(decodeURIComponent(devCookie));
          const role = parsed.role;
          if (role === 'developer' || role === 'lawyer') {
            // Lawyers blocked from developer admin
            if (role === 'lawyer' && pathname.startsWith('/app/admin')) {
              return NextResponse.redirect(new URL('/access-denied', request.url));
            }
            // Developer skips onboarding
            if (role === 'developer' && pathname === '/app/onboarding') {
              return NextResponse.redirect(new URL('/app', request.url));
            }
            return response;
          }
        } catch {}
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Live Supabase Auth verification
    const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
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

    // getUser() validates the JWT cryptographically server-side — tamper-proof
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }

    const role = user.app_metadata?.role as string | undefined;

    // Unapproved Google accounts or clients -> Access Denied
    if (role !== 'developer' && role !== 'lawyer') {
      return NextResponse.redirect(new URL('/access-denied?reason=unauthorized', request.url));
    }

    // Lawyers cannot access /app/admin/* (developer-only)
    if (role === 'lawyer' && pathname.startsWith('/app/admin')) {
      return NextResponse.redirect(new URL('/access-denied', request.url));
    }

    // Developer bypasses onboarding
    if (role === 'developer' && pathname === '/app/onboarding') {
      return NextResponse.redirect(new URL('/app', request.url));
    }

    // Lawyer onboarding enforcement
    if (role === 'lawyer' && pathname !== '/app/onboarding') {
      const onboardedCookie = request.cookies.get('vakildesk_onboarding_completed')?.value;
      const onboardedMeta = user.user_metadata?.onboarding_completed === true;
      if (!onboardedCookie && !onboardedMeta) {
        return NextResponse.redirect(new URL('/app/onboarding', request.url));
      }
    }

    return response;
  }

  // Any unrecognised non-public path → redirect to /app
  return NextResponse.redirect(new URL('/app', request.url));
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

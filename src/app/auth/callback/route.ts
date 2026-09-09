import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Supabase Auth OAuth Callback Route (PKCE SSR Flow).
 * 
 * 1. Exchanges OAuth 'code' for a valid Supabase session.
 * 2. Checks user email against public.approved_users (strictly via service role).
 * 3. If unapproved or deactivated (is_active = false):
 *    - Revokes session immediately.
 *    - Redirects to /access-denied.
 * 4. If approved developer (e.g. mahanti9988@gmail.com):
 *    - Stamps app_metadata.role = 'developer'
 *    - Bypasses lawyer onboarding -> redirects to /app.
 * 5. If approved lawyer:
 *    - Stamps app_metadata.role = 'lawyer'
 *    - Checks profile.onboarding_completed:
 *      * If false -> redirects to /app/onboarding.
 *      * If true  -> redirects to /app.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');
  const requestedNext = requestUrl.searchParams.get('next') || '/app';
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/app';

  // Handle OAuth provider errors cleanly
  if (error) {
    console.error('OAuth error:', error, errorDescription);
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', errorDescription || error);
    return NextResponse.redirect(loginUrl);
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'placeholder-publishable-key';

  const response = NextResponse.redirect(new URL(next, request.url));

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

  // Exchange PKCE code for session
  const { data: { session }, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !session?.user) {
    console.error('Code exchange failed:', exchangeError);
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }

  const user = session.user;
  const userEmail = user.email?.toLowerCase();

  if (!userEmail) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/access-denied?reason=no_email', request.url));
  }

  // Authorize via database allowlist (service role only)
  let serviceClient;
  try {
    serviceClient = createServiceClient();
  } catch (err) {
    console.error('Service client unavailable in auth callback:', err);
    // If database configuration is missing on server, cannot verify authorization
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/access-denied?reason=service_unavailable', request.url));
  }

  const { data: approvedUser, error: queryError } = await (serviceClient as any)
    .from('approved_users')
    .select('role, is_active')
    .eq('email', userEmail)
    .maybeSingle();

  if (queryError || !approvedUser || approvedUser.is_active !== true) {
    console.warn(`Unauthorized login attempt by: ${userEmail}`);
    // Revoke session immediately
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/access-denied?reason=unauthorized', request.url));
  }

  const assignedRole = approvedUser.role;

  // Stamp role in raw_app_meta_data if not already present or out of sync
  if (user.app_metadata?.role !== assignedRole) {
    const { error: updateError } = await (serviceClient as any).auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, role: assignedRole },
    });
    if (updateError) {
      console.error('Unable to assign user role:', updateError);
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
    }

    // The exchanged JWT contains the old app_metadata. Refresh it before the
    // protected route middleware validates the role claim.
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || refreshed.user?.app_metadata?.role !== assignedRole) {
      console.error('Unable to refresh role-bearing session:', refreshError);
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
    }
  }

  // Developer bypasses lawyer onboarding
  if (assignedRole === 'developer') {
    return NextResponse.redirect(new URL('/app', request.url));
  }

  // Lawyer: check if onboarding has been completed
  if (assignedRole === 'lawyer') {
    const { data: profile } = await (serviceClient as any)
      .from('profiles')
      .select('onboarding_completed')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile || profile.onboarding_completed !== true) {
      return NextResponse.redirect(new URL('/app/onboarding', request.url));
    }
  }

  return response;
}

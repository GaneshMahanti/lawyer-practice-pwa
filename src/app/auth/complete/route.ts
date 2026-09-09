import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Completes a password-based Supabase sign-in. OAuth uses /auth/callback;
 * password sessions already exist in the browser, so this route performs the
 * same server-only allowlist check and makes the role claim current.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const requestedNext = requestUrl.searchParams.get('next') || '/app';
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/app';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }

  const response = NextResponse.redirect(new URL(next, request.url));
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.email) {
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }

  let serviceClient;
  try {
    serviceClient = createServiceClient();
  } catch (error) {
    console.error('Service client unavailable during password authorization:', error);
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }

  const { data: approvedUser, error: approvalError } = await (serviceClient as any)
    .from('approved_users')
    .select('role, is_active')
    .eq('email', user.email.toLowerCase())
    .maybeSingle();

  if (approvalError || !approvedUser || approvedUser.is_active !== true) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/access-denied?reason=unauthorized', request.url));
  }

  const assignedRole = approvedUser.role;
  if (user.app_metadata?.role !== assignedRole) {
    const { error: updateError } = await (serviceClient as any).auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, role: assignedRole },
    });
    if (updateError) {
      console.error('Unable to assign user role:', updateError);
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
    }
  }

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || refreshed.user?.app_metadata?.role !== assignedRole) {
    console.error('Unable to refresh role-bearing session:', refreshError);
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }

  return response;
}

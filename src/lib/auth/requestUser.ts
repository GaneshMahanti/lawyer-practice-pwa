import type { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { isAnonymousUser, isRealAppUser } from '@/lib/supabase/auth';

/**
 * The `vakildesk_dev_session` cookie is a LOCAL-DEVELOPMENT convenience for when
 * Supabase is not configured. It is plain JSON set by the browser, so anyone can
 * forge it. It is therefore never honoured in production, and never honoured
 * when a live Supabase project is configured.
 */
function isDevSessionAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function getDevSessionUser(request: NextRequest): User | null {
  if (!isDevSessionAllowed()) return null;
  const devCookie = request.cookies.get('vakildesk_dev_session')?.value;
  if (!devCookie) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(devCookie));
    if (parsed?.id) {
      return {
        id: parsed.id,
        email: parsed.email || 'developer@vakildesk.internal',
        app_metadata: { role: parsed.role || 'lawyer' },
        user_metadata: { name: parsed.name || 'Advocate' },
      } as unknown as User;
    }
  } catch {}
  return null;
}

export async function getRequestUser(request: NextRequest): Promise<User | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Supabase not configured: local development only (returns null in production).
  if (!url || !key || url === 'https://placeholder.supabase.co') {
    return getDevSessionUser(request);
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: () => {},
    },
  });

  // getUser() verifies the session with Supabase. With a live project this is the
  // ONLY source of identity - no cookie fallback.
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

/** Real advocate/developer OR a demo sandbox session. Use for features demo users may see (with mocked data). */
export async function requireWorkspaceUser(request: NextRequest): Promise<User | null> {
  const user = await getRequestUser(request);
  if (!user) return null;
  if (isAnonymousUser(user) || isRealAppUser(user)) return user;
  return null;
}

/** Approved lawyer or developer only. Demo sessions are rejected. Use for anything that costs money or touches real data. */
export async function requireRealAppUser(request: NextRequest): Promise<User | null> {
  const user = await getRequestUser(request);
  return isRealAppUser(user) ? user : null;
}

/** Developer only (role comes from server-set app_metadata). */
export async function requireDeveloperUser(request: NextRequest): Promise<User | null> {
  const user = await requireRealAppUser(request);
  if (!user) return null;
  return user.app_metadata?.role === 'developer' ? user : null;
}

import type { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { isAnonymousUser, isRealAppUser } from '@/lib/supabase/auth';

function getDevSessionUser(request: NextRequest): User | null {
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
  if (!url || !key || url === 'https://placeholder.supabase.co') {
    return getDevSessionUser(request);
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: () => {},
    },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return getDevSessionUser(request);
  }
  return user;
}

export async function requireWorkspaceUser(request: NextRequest): Promise<User | null> {
  const user = await getRequestUser(request);
  if (!user) return null;
  if (isAnonymousUser(user) || isRealAppUser(user)) return user;
  return null;
}

export async function requireRealAppUser(request: NextRequest): Promise<User | null> {
  const user = await getRequestUser(request);
  return isRealAppUser(user) ? user : null;
}

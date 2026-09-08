import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export type AppRole = 'developer' | 'lawyer';

export interface SessionUser {
  id: string;
  email: string | undefined;
  role: AppRole;
}

export async function createClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing user sessions.
        }
      },
    },
  });
}

/**
 * Returns the authenticated session user with their role, or null if not authenticated.
 * Role is read from app_metadata (set via service-role key — cannot be set by users themselves).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) return null;

    const role = user.app_metadata?.role as AppRole | undefined;
    if (role !== 'developer' && role !== 'lawyer') return null;

    return {
      id: user.id,
      email: user.email,
      role,
    };
  } catch {
    return null;
  }
}


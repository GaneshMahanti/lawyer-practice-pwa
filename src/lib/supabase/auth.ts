import type { User } from '@supabase/supabase-js';

export function isAnonymousUser(user: User | null | undefined): boolean {
  return (
    user?.is_anonymous === true ||
    user?.app_metadata?.provider === 'anonymous' ||
    user?.app_metadata?.role === 'demo' ||
    user?.user_metadata?.is_demo === true
  );
}

export function isRealAppUser(user: User | null | undefined): boolean {
  const role = (user?.app_metadata?.role || user?.user_metadata?.role || '') as string;
  return !isAnonymousUser(user) && (role === 'developer' || role === 'lawyer');
}

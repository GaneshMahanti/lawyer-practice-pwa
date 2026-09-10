import type { User } from '@supabase/supabase-js';

export function isAnonymousUser(user: User | null | undefined): boolean {
  return user?.is_anonymous === true || user?.app_metadata?.provider === 'anonymous';
}

export function isRealAppUser(user: User | null | undefined): boolean {
  const role = user?.app_metadata?.role;
  return !isAnonymousUser(user) && (role === 'developer' || role === 'lawyer');
}

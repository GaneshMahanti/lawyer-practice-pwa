import type { User } from '@supabase/supabase-js';

/**
 * The three kinds of account in VakilDesk.
 *   developer - you. Full access, including /app/admin and /api/admin/*.
 *   lawyer    - an approved advocate. Own workspace only.
 *   demo      - anonymous sandbox session. Sample data, mocked AI, no payments/portal/WhatsApp.
 *   none      - signed in but not approved (or not signed in at all).
 */
export type AccountKind = 'developer' | 'lawyer' | 'demo' | 'none';

export function isAnonymousUser(user: User | null | undefined): boolean {
  return (
    user?.is_anonymous === true ||
    user?.app_metadata?.provider === 'anonymous' ||
    user?.app_metadata?.role === 'demo' ||
    user?.user_metadata?.is_demo === true
  );
}

/**
 * Role is read ONLY from app_metadata, which can be written by the server
 * (service key) but never by the signed-in user. user_metadata is editable by
 * the user themselves, so it must never be able to grant a role.
 */
export function getAccountKind(user: User | null | undefined): AccountKind {
  if (!user) return 'none';
  if (isAnonymousUser(user)) return 'demo';
  const role = user.app_metadata?.role;
  if (role === 'developer') return 'developer';
  if (role === 'lawyer') return 'lawyer';
  return 'none';
}

export function isRealAppUser(user: User | null | undefined): boolean {
  const kind = getAccountKind(user);
  return kind === 'developer' || kind === 'lawyer';
}

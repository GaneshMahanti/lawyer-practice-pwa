import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * POST /api/auth/logout
 *
 * Clears the lawyer's single-device session nonce in approved_users, then
 * signs the user out of Supabase. Must be called instead of client-side
 * supabase.auth.signOut() so that the next login on any device is permitted.
 *
 * Developers are not subject to the session nonce; this route still signs
 * them out safely.
 */
export async function POST(_request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user?.email) {
    try {
      const service = createServiceClient() as any;
      await service
        .from('approved_users')
        .update({
          session_nonce: null,
          session_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('email', user.email.toLowerCase());
    } catch {
      // Non-fatal: proceed with sign-out even if nonce clear fails.
    }
  }

  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}

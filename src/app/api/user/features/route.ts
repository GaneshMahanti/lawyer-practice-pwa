import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRequestUser } from '@/lib/auth/requestUser';
import { isAnonymousUser } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/user/features
 *
 * Returns the feature flags for the currently authenticated user:
 *   { ai_enabled: boolean; notes_enabled: boolean }
 *
 * Demo users and developers always have all features enabled.
 * Lawyers get the values from their approved_users row.
 */
export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Demo users and developers: full access
  if (isAnonymousUser(user) || user.app_metadata?.role === 'developer') {
    return NextResponse.json({ ai_enabled: true, notes_enabled: true });
  }

  if (!user.email) {
    return NextResponse.json({ ai_enabled: false, notes_enabled: false });
  }

  try {
    const service = createServiceClient() as any;
    const { data } = await service
      .from('approved_users')
      .select('ai_enabled, notes_enabled')
      .eq('email', user.email.toLowerCase())
      .maybeSingle();

    return NextResponse.json({
      ai_enabled: data?.ai_enabled !== false,
      notes_enabled: data?.notes_enabled !== false,
    });
  } catch {
    // Fail open so a DB hiccup doesn't break the app for real lawyers.
    return NextResponse.json({ ai_enabled: true, notes_enabled: true });
  }
}

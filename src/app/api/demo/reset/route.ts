import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAnonymousUser } from '@/lib/supabase/auth';

function clientFor(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createServerClient(url, key, {
    cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} },
  });
}

export async function POST(request: NextRequest) {
  const supabase = clientFor(request);
  if (!supabase) return NextResponse.json({ error: 'Demo service unavailable' }, { status: 503 });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !isAnonymousUser(user)) return NextResponse.json({ error: 'Demo access required' }, { status: 403 });
  const { error: resetError } = await supabase.rpc('reset_demo_workspace');
  if (resetError) {
    console.error('Demo reset failed:', resetError.message);
    return NextResponse.json({ error: 'Unable to reset demo workspace' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

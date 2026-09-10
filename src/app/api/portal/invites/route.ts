import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/service';
import { isRealAppUser } from '@/lib/supabase/auth';

type InviteRequest = {
  provisionalName?: unknown;
  fees?: {
    consultation?: unknown;
    legal_notice?: unknown;
    case_fee?: unknown;
  };
};

function feeSnapshot(fees: InviteRequest['fees']) {
  const feeTypes = ['consultation', 'legal_notice', 'case_fee'] as const;
  return feeTypes.flatMap((fee_type) => {
    const amount = Number(fees?.[fee_type] || 0);
    return Number.isFinite(amount) && amount > 0
      ? [{ fee_type, amount, razorpay_link_url: null }]
      : [];
  });
}

async function getAuthenticatedUser(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: () => {},
    },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  return error || !isRealAppUser(user) ? null : user;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  try {
    const body = await request.json() as InviteRequest;
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const service = createServiceClient() as any;
    const { error } = await service.from('portal_invites').insert({
      owner_id: user.id,
      token_hash: createHash('sha256').update(token).digest('hex'),
      status: 'pending',
      advocate_name: user.user_metadata?.full_name || user.email || 'Your Advocate',
      client_name: typeof body.provisionalName === 'string' && body.provisionalName.trim()
        ? body.provisionalName.trim()
        : null,
      fee_snapshot: feeSnapshot(body.fees),
      expires_at: expiresAt,
    });
    if (error) {
      console.error('Portal invite creation failed:', error);
      return NextResponse.json({ error: 'Unable to create the invite' }, { status: 500 });
    }
    return NextResponse.json({ token, expiresAt });
  } catch (error) {
    console.error('Portal invite request failed:', error);
    return NextResponse.json({ error: 'Unable to create the invite' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  try {
    const { token } = await request.json();
    if (!token || typeof token !== 'string') return NextResponse.json({ error: 'Invalid invite' }, { status: 400 });
    const service = createServiceClient() as any;
    const { error } = await service
      .from('portal_invites')
      .delete()
      .eq('owner_id', user.id)
      .eq('token_hash', createHash('sha256').update(token).digest('hex'));
    if (error) {
      console.error('Portal invite deletion failed:', error);
      return NextResponse.json({ error: 'Unable to delete the invite' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Unable to delete the invite' }, { status: 500 });
  }
}

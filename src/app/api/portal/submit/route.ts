import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      inviteId,
      token,
      name,
      phone_1,
      phone_2,
      aadhaar_last4,
      current_address,
      permanent_address,
    } = body;

    // 1. Basic field validations
    if (!token || typeof token !== 'string' || token.length < 32) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }
    if (!inviteId || typeof inviteId !== 'string') {
      return NextResponse.json({ error: 'Invalid invite ID' }, { status: 400 });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!phone_1 || typeof phone_1 !== 'string' || !/^\d{10}$/.test(phone_1.replace(/\s|-/g, ''))) {
      return NextResponse.json({ error: 'Valid 10-digit primary phone is required' }, { status: 400 });
    }
    if (!aadhaar_last4 || !/^\d{4}$/.test(aadhaar_last4)) {
      return NextResponse.json({ error: 'Valid last 4 digits of Aadhaar required' }, { status: 400 });
    }
    if (!current_address || typeof current_address !== 'string' || !current_address.trim()) {
      return NextResponse.json({ error: 'Current address is required' }, { status: 400 });
    }
    if (!permanent_address || typeof permanent_address !== 'string' || !permanent_address.trim()) {
      return NextResponse.json({ error: 'Permanent address is required' }, { status: 400 });
    }

    let supabase;
    try {
      supabase = createServiceClient();
    } catch {
      return NextResponse.json({ error: 'Database service unavailable' }, { status: 503 });
    }

    // 2. Validate token hash against portal_invites
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const db = supabase as any;
    const { data: invite, error: inviteError } = await db
      .from('portal_invites')
      .select('id, owner_id, expires_at, revoked_at, used_at')
      .eq('id', inviteId)
      .eq('token_hash', tokenHash)
      .single();

    if (inviteError || !invite) {
      return NextResponse.json({ error: 'Invalid invite link' }, { status: 403 });
    }

    if (invite.revoked_at) {
      return NextResponse.json({ error: 'This registration link has been revoked' }, { status: 403 });
    }

    if (invite.used_at) {
      return NextResponse.json({ error: 'This registration link has already been used' }, { status: 409 });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This registration link has expired' }, { status: 410 });
    }

    // 3. Insert submission record into portal_submissions
    const cleanPhone1 = phone_1.replace(/\s|-/g, '');
    const cleanPhone2 = phone_2 ? phone_2.replace(/\s|-/g, '') : null;

    const { error: insertError } = await db
      .from('portal_submissions')
      .insert({
        invite_id: invite.id,
        owner_id: invite.owner_id,
        name: name.trim(),
        phone_1: cleanPhone1,
        phone_2: cleanPhone2,
        aadhaar_last4: aadhaar_last4.trim(),
        current_address: current_address.trim(),
        permanent_address: permanent_address.trim(),
      });

    if (insertError) {
      console.error('Portal submission error:', insertError);
      return NextResponse.json({ error: 'Failed to record submission' }, { status: 500 });
    }

    // 4. Mark invite as used atomically
    await db
      .from('portal_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invite.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Portal submit unexpected exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

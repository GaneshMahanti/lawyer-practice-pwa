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
      return NextResponse.json({ error: 'Full legal name is required' }, { status: 400 });
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
      return NextResponse.json({ error: 'Database service configuration missing' }, { status: 503 });
    }

    // 2. Validate token hash against portal_invites
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const db = supabase as any;
    const { data: invite, error: inviteError } = await db
      .from('portal_invites')
      .select('id, owner_id, fee_snapshot, status, expires_at, revoked_at, client_id')
      .eq('id', inviteId)
      .eq('token_hash', tokenHash)
      .single();

    if (inviteError || !invite) {
      return NextResponse.json({ error: 'Invalid invite link' }, { status: 403 });
    }

    if (invite.status === 'revoked' || invite.revoked_at) {
      return NextResponse.json({ error: 'This registration link has been revoked' }, { status: 403 });
    }

    if (invite.status === 'completed') {
      return NextResponse.json({ error: 'This registration and payment workflow is already completed' }, { status: 409 });
    }

    if (invite.status === 'expired' || new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This registration link has expired' }, { status: 410 });
    }

    // 3. Upsert submission record into portal_submissions (idempotent on retries)
    const cleanPhone1 = phone_1.replace(/\s|-/g, '');
    const cleanPhone2 = phone_2 ? phone_2.replace(/\s|-/g, '') : null;
    const nowIso = new Date().toISOString();

    const { data: existingSub } = await db
      .from('portal_submissions')
      .select('id')
      .eq('invite_id', invite.id)
      .maybeSingle();

    if (existingSub) {
      await db
        .from('portal_submissions')
        .update({
          name: name.trim(),
          phone_1: cleanPhone1,
          phone_2: cleanPhone2,
          aadhaar_last4: aadhaar_last4.trim(),
          current_address: current_address.trim(),
          permanent_address: permanent_address.trim(),
          submitted_at: nowIso,
        })
        .eq('id', existingSub.id);
    } else {
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
          submitted_at: nowIso,
        });

      if (insertError) {
        console.error('Portal submission error:', insertError);
        return NextResponse.json({ error: 'Failed to record submission' }, { status: 500 });
      }
    }

    // 4. Determine next status based on fees:
    // If fees are attached, advance to 'payment_pending'
    // If no fees are attached, advance to 'completed' and activate client immediately
    const feeSnapshot = invite.fee_snapshot || [];
    const hasFeesToPay = Array.isArray(feeSnapshot) && feeSnapshot.some((f: any) => f.amount > 0);
    const nextStatus = hasFeesToPay ? 'payment_pending' : 'completed';

    // 5. Create or link exactly ONE Client record idempotently
    let targetClientId: string | null = invite.client_id || null;

    if (targetClientId) {
      const { data: existingClient } = await db
        .from('clients')
        .select('id')
        .eq('id', targetClientId)
        .maybeSingle();
      if (!existingClient) {
        targetClientId = null;
      }
    }

    if (!targetClientId) {
      // Try to find provisional client created by registration_token
      const { data: clientByToken } = await db
        .from('clients')
        .select('id')
        .eq('registration_token', token)
        .eq('owner_id', invite.owner_id)
        .maybeSingle();

      if (clientByToken) {
        targetClientId = clientByToken.id;
      }
    }

    if (targetClientId) {
      // Update existing client with verified KYC information
      await db
        .from('clients')
        .update({
          name: name.trim(),
          phone: cleanPhone1,
          phone_2: cleanPhone2,
          aadhaar_last4: aadhaar_last4.trim(),
          current_address: current_address.trim(),
          permanent_address: permanent_address.trim(),
          whatsapp_opt_in: true,
          whatsapp_opt_in_at: nowIso,
          status: nextStatus === 'completed' ? 'active' : 'pending',
          registration_token: nextStatus === 'completed' ? null : token,
          token_expires_at: nextStatus === 'completed' ? null : invite.expires_at,
          updated_at: nowIso,
        })
        .eq('id', targetClientId);
    } else {
      // Create new client record
      targetClientId = crypto.randomUUID();
      await db
        .from('clients')
        .insert({
          id: targetClientId,
          owner_id: invite.owner_id,
          name: name.trim(),
          phone: cleanPhone1,
          phone_2: cleanPhone2,
          aadhaar_last4: aadhaar_last4.trim(),
          current_address: current_address.trim(),
          permanent_address: permanent_address.trim(),
          whatsapp_opt_in: true,
          whatsapp_opt_in_at: nowIso,
          preferred_language: 'en',
          status: nextStatus === 'completed' ? 'active' : 'pending',
          is_practice_active: true,
          registration_token: nextStatus === 'completed' ? null : token,
          token_expires_at: nextStatus === 'completed' ? null : invite.expires_at,
          created_at: nowIso,
          updated_at: nowIso,
        });
    }

    // 6. Ensure fee records exist in client_fees for the client
    if (hasFeesToPay && targetClientId) {
      const { data: existingFees } = await db
        .from('client_fees')
        .select('fee_type')
        .eq('client_id', targetClientId);

      const existingTypes = new Set((existingFees || []).map((f: any) => f.fee_type));
      for (const f of feeSnapshot) {
        if (f.amount > 0 && !existingTypes.has(f.fee_type)) {
          await db.from('client_fees').insert({
            id: crypto.randomUUID(),
            client_id: targetClientId,
            owner_id: invite.owner_id,
            fee_type: f.fee_type,
            amount: f.amount,
            payment_status: 'unpaid',
            created_at: nowIso,
          });
        }
      }
    }

    // 7. Update portal_invites with client_id and status
    await db
      .from('portal_invites')
      .update({
        client_id: targetClientId,
        client_name: name.trim(),
        status: nextStatus,
        submitted_at: nowIso,
        completed_at: nextStatus === 'completed' ? nowIso : null,
      })
      .eq('id', invite.id);

    return NextResponse.json({ success: true, status: nextStatus, clientId: targetClientId });
  } catch (err) {
    console.error('Portal submit unexpected exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

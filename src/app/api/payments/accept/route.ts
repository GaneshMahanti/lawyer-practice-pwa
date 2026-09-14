import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';

interface AcceptPaymentRequest {
  clientId: string;
  inviteId?: string;
  method: 'cash' | 'upi';
}

export async function POST(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: AcceptPaymentRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const { clientId, inviteId, method } = body;

  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
  }

  if (method !== 'cash' && method !== 'upi') {
    return NextResponse.json({ error: 'Payment method must be cash or upi' }, { status: 400 });
  }

  const methodLabel = method === 'cash' ? 'Cash' : 'Manual UPI';

  try {
    const service = createServiceClient() as any;

    // 1. Verify client ownership
    const { data: client, error: clientError } = await service
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .eq('owner_id', user.id)
      .single();

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client record not found or access denied' }, { status: 404 });
    }

    // 2. Fetch associated invite (if inviteId is passed or by client_id)
    let invite = null;
    if (inviteId) {
      const { data: inv } = await service
        .from('portal_invites')
        .select('*')
        .eq('id', inviteId)
        .eq('owner_id', user.id)
        .maybeSingle();
      invite = inv;
    }

    if (!invite) {
      const { data: inv } = await service
        .from('portal_invites')
        .select('*')
        .eq('client_id', clientId)
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false })
        .maybeSingle();
      invite = inv;
    }

    // Prevent duplicate processing if already completed
    if (invite && invite.status === 'completed' && client.status === 'active') {
      return NextResponse.json({ error: 'Payment has already been recorded and client is active.' }, { status: 409 });
    }

    // 3. Compute payment amount
    const { data: fees } = await service
      .from('client_fees')
      .select('*')
      .eq('client_id', clientId);

    let totalAmountRupees = 0;
    if (fees && fees.length > 0) {
      totalAmountRupees = fees.reduce((sum: number, f: any) => sum + Number(f.amount || 0), 0);
    } else if (invite && Array.isArray(invite.fee_snapshot)) {
      totalAmountRupees = invite.fee_snapshot.reduce((sum: number, f: any) => sum + Number(f.amount || 0), 0);
    }

    if (totalAmountRupees <= 0) {
      totalAmountRupees = 1; // Minimum paise constraint check (CHECK amount_paise > 0)
    }

    const totalAmountPaise = Math.round(totalAmountRupees * 100);
    const nowIso = new Date().toISOString();
    const invoiceNumber = `INV-${Date.now()}`;
    const invoiceId = crypto.randomUUID();

    // 4. Create invoice record
    const { error: invoiceError } = await service
      .from('invoices')
      .insert({
        id: invoiceId,
        owner_id: user.id,
        client_id: client.id,
        invoice_number: invoiceNumber,
        description: `Legal Representation Fee (${methodLabel})`,
        amount_paise: totalAmountPaise,
        invoice_status: 'paid',
        due_at: nowIso,
        payment_link_status: 'paid',
        razorpay_payment_link_id: null,
        razorpay_payment_link_url: null,
        created_at: nowIso,
        updated_at: nowIso,
      });

    if (invoiceError) {
      console.error('Invoice creation failed:', invoiceError);
      return NextResponse.json({ error: 'Failed to record invoice' }, { status: 500 });
    }

    // 5. Create payment record (deterministic provider_event_id for idempotency)
    const providerEventId = `manual_${method}_${invite?.id || client.id}`;
    const { error: paymentError } = await service
      .from('payments')
      .insert({
        id: crypto.randomUUID(),
        owner_id: user.id,
        client_id: client.id,
        invoice_id: invoiceId,
        amount_paise: totalAmountPaise,
        razorpay_payment_id: null,
        razorpay_payment_link_id: null,
        payment_status: 'captured',
        paid_at: nowIso,
        provider_event_id: providerEventId,
        created_at: nowIso,
      });

    if (paymentError) {
      // Check if duplicate
      if (paymentError.code === '23505') {
        console.warn('Payment record already exists for provider_event_id:', providerEventId);
      } else {
        console.error('Payment creation failed:', paymentError);
        return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 });
      }
    }

    // 6. Update client_fees to paid
    await service
      .from('client_fees')
      .update({ payment_status: 'paid' })
      .eq('client_id', client.id);

    // 7. Activate client
    await service
      .from('clients')
      .update({
        status: 'active',
        registration_token: null,
        token_expires_at: null,
        updated_at: nowIso,
      })
      .eq('id', client.id);

    // 8. Complete invite
    if (invite) {
      await service
        .from('portal_invites')
        .update({
          status: 'completed',
          completed_at: nowIso,
          client_id: client.id,
        })
        .eq('id', invite.id);
    }

    // 9. Create immutable audit log entry
    await service
      .from('audit_logs')
      .insert({
        id: crypto.randomUUID(),
        owner_id: user.id,
        action: 'payment.manual_accepted',
        resource_type: 'client',
        resource_id: client.id,
        metadata_json: {
          lawyer_id: user.id,
          client_id: client.id,
          invite_id: invite?.id || null,
          amount_rupees: totalAmountRupees,
          amount_paise: totalAmountPaise,
          payment_method: methodLabel,
          invoice_number: invoiceNumber,
          timestamp: nowIso,
        },
        outcome: 'success',
        created_at: nowIso,
      });

    return NextResponse.json({
      success: true,
      clientId: client.id,
      invoiceNumber,
      amountRupees: totalAmountRupees,
      paymentMethod: methodLabel,
    });
  } catch (err) {
    console.error('Accept payment unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

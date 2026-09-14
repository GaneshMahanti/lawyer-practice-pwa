import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook is not configured.' }, { status: 503 });

  const signature = request.headers.get('x-razorpay-signature');
  const raw = await request.text();
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 401 });

  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  if (expected !== signature) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  let event: { event?: string; payload?: any };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const payment = event.payload?.payment?.entity;
  const eventId = payment?.id || event.payload?.payment_link?.entity?.id;
  if (!eventId || (event.event !== 'payment_link.paid' && event.event !== 'payment.captured')) {
    return NextResponse.json({ received: true });
  }

  try {
    const service = createServiceClient() as { from: (table: string) => any };
    const ownerId = payment?.notes?.owner_id;
    const clientId = payment?.notes?.client_id;
    if (!ownerId || !clientId) return NextResponse.json({ received: true });

    const nowIso = new Date().toISOString();

    // 1. Insert payment record (idempotent via unique provider_event_id)
    await service.from('payments').insert({
      owner_id: ownerId,
      client_id: clientId,
      invoice_id: payment?.notes?.invoice_id,
      amount_paise: payment?.amount,
      razorpay_payment_id: payment?.id,
      payment_status: 'captured',
      provider_event_id: eventId,
    });

    // 2. Mark invoice as paid if invoice_id exists
    if (payment?.notes?.invoice_id) {
      await service.from('invoices').update({
        invoice_status: 'paid',
        payment_link_status: 'paid',
        updated_at: nowIso,
      }).eq('id', payment.notes.invoice_id);
    }

    // 3. Mark client_fees as paid
    await service.from('client_fees').update({
      payment_status: 'paid',
    }).eq('client_id', clientId);

    // 4. Activate client
    await service.from('clients').update({
      status: 'active',
      registration_token: null,
      token_expires_at: null,
      updated_at: nowIso,
    }).eq('id', clientId);

    // 5. Complete invite if linked
    await service.from('portal_invites').update({
      status: 'completed',
      completed_at: nowIso,
    }).eq('client_id', clientId).neq('status', 'completed');

    // 6. Record immutable audit log
    await service.from('audit_logs').insert({
      id: crypto.randomUUID(),
      owner_id: ownerId,
      action: 'client_payment_captured',
      resource_type: 'payment',
      resource_id: clientId,
      metadata_json: {
        lawyer_id: ownerId,
        client_id: clientId,
        amount_paise: payment?.amount,
        razorpay_payment_id: payment?.id,
        provider_event_id: eventId,
        timestamp: nowIso,
      },
      outcome: 'success',
      created_at: nowIso,
    });
  } catch (error) {
    console.error('Payment webhook persist failed:', error);
  }

  return NextResponse.json({ received: true });
}

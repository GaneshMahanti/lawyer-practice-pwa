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
    await service.from('payments').insert({
      owner_id: ownerId,
      client_id: clientId,
      invoice_id: payment?.notes?.invoice_id,
      amount_paise: payment?.amount,
      razorpay_payment_id: payment?.id,
      payment_status: 'captured',
      provider_event_id: eventId,
    });
  } catch (error) {
    console.error('Payment webhook persist failed:', error);
  }

  return NextResponse.json({ received: true });
}

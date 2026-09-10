import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Payment links are not available in Demo Mode.' }, { status: 403 });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return NextResponse.json({ error: 'Razorpay is not configured.' }, { status: 503 });
  }

  let body: { amountRupees?: unknown; description?: unknown; clientId?: unknown; customerName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const amountRupees = Number(body.amountRupees);
  if (!Number.isFinite(amountRupees) || amountRupees < 1) {
    return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 });
  }

  const amountPaise = Math.round(amountRupees * 100);
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const razorpayRes = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      description: typeof body.description === 'string' ? body.description : 'Advocate fee',
      customer: {
        name: typeof body.customerName === 'string' ? body.customerName : 'Client',
      },
      notify: { sms: false, email: false },
      notes: {
        owner_id: user.id,
        client_id: typeof body.clientId === 'string' ? body.clientId : '',
      },
    }),
  });

  const payload = await razorpayRes.json();
  if (!razorpayRes.ok) {
    return NextResponse.json({ error: 'Unable to create the payment link.' }, { status: 502 });
  }

  try {
    const service = createServiceClient() as { from: (table: string) => any };
    const invoiceNumber = `INV-${Date.now()}`;
    await service.from('invoices').insert({
      owner_id: user.id,
      client_id: typeof body.clientId === 'string' ? body.clientId : null,
      invoice_number: invoiceNumber,
      description: typeof body.description === 'string' ? body.description : 'Advocate fee',
      amount_paise: amountPaise,
      invoice_status: 'issued',
      razorpay_payment_link_id: payload.id,
      razorpay_payment_link_url: payload.short_url,
      payment_link_status: 'created',
    });
  } catch (error) {
    console.error('Invoice persist failed:', error);
  }

  return NextResponse.json({
    id: payload.id,
    url: payload.short_url,
    amountPaise,
  });
}

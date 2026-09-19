import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireDeveloperUser as requireDeveloper } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Admin API for managing the approved_users allowlist.
 *
 * Only accessible to authenticated developers. Uses the Supabase service role
 * key (never exposed to the browser) to write into approved_users, since that
 * table is locked down against direct client access by design.
 *
 *   GET     -> list every approved user
 *   POST    -> upsert one user by email (add or update)
 *   PATCH   -> partial update by id (is_active / plan / subscription_end)
 *   DELETE  -> delete by id  (query: ?id=...)
 */

type AllowedPlan = 'basic' | 'standard' | 'premium';
type AllowedRole = 'developer' | 'lawyer';

export async function GET(request: NextRequest) {
  const dev = await requireDeveloper(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return NextResponse.json({ error: 'Service key not configured on server.' }, { status: 503 });
  }

  const { data, error } = await (service as any)
    .from('approved_users')
    .select('id, email, name, role, plan, phone, is_active, subscription_end, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data || [] });
}

export async function POST(request: NextRequest) {
  const dev = await requireDeveloper(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const phone = body.phone ? String(body.phone).trim() : null;
  const role: AllowedRole = body.role === 'developer' ? 'developer' : 'lawyer';
  const plan: AllowedPlan =
    body.plan === 'basic' || body.plan === 'premium' ? body.plan : 'standard';

  // Default subscription_end: 1 year from today.
  const rawSubEnd = body.subscription_end as string | undefined;
  const subEnd = rawSubEnd
    ? new Date(rawSubEnd)
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  if (!email.includes('@') || email.length < 5) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
  }
  if (!Number.isFinite(subEnd.getTime())) {
    return NextResponse.json({ error: 'Invalid subscription end date.' }, { status: 400 });
  }

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return NextResponse.json({ error: 'Service key not configured on server.' }, { status: 503 });
  }

  const { data, error } = await (service as any)
    .from('approved_users')
    .upsert(
      {
        email,
        name,
        phone,
        role,
        plan,
        subscription_end: subEnd.toISOString(),
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email' },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}

export async function PATCH(request: NextRequest) {
  const dev = await requireDeveloper(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = body.id ? String(body.id) : '';
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if ('is_active' in body) updates.is_active = !!body.is_active;

  if ('plan' in body && (body.plan === 'basic' || body.plan === 'standard' || body.plan === 'premium')) {
    updates.plan = body.plan;
  }

  if ('subscription_end' in body && body.subscription_end) {
    const d = new Date(String(body.subscription_end));
    if (Number.isFinite(d.getTime())) updates.subscription_end = d.toISOString();
  }

  if ('name' in body && typeof body.name === 'string' && body.name.trim()) {
    updates.name = body.name.trim();
  }

  if ('phone' in body) {
    updates.phone = body.phone ? String(body.phone).trim() : null;
  }

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return NextResponse.json({ error: 'Service key not configured on server.' }, { status: 503 });
  }

  const { data, error } = await (service as any)
    .from('approved_users')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}

export async function DELETE(request: NextRequest) {
  const dev = await requireDeveloper(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return NextResponse.json({ error: 'Service key not configured on server.' }, { status: 503 });
  }

  const { error } = await (service as any)
    .from('approved_users')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

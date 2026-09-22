/**
 * GET  /api/admin/config   — read editable config + rate card   (DEVELOPER ONLY)
 * POST /api/admin/config   — update one config key or one rate card row   (DEVELOPER ONLY)
 *
 * POST body: { type: 'config', key, value } | { type: 'rate_card', feature, paise_per_unit }
 *
 * Validated ranges:
 *   recharge_credit_percent : 50–100 (integer)
 *   min_recharge_paise      : 1000–500000 (Rs 10 – Rs 5,000)
 *   included_credit_paise   : 1–10000000
 *   low_balance_paise       : 100–1000000
 *   daily_ai_cap_paise      : 1000–1000000 (Rs 10 – Rs 10,000)
 *   upi_vpa / upi_payee_name: non-empty strings, NEVER logged
 *
 * Rate card: paise_per_unit must be >= 0.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireDeveloperUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

const EDITABLE_KEYS = [
  'recharge_credit_percent',
  'min_recharge_paise',
  'included_credit_paise',
  'low_balance_paise',
  'daily_ai_cap_paise',
  'upi_vpa',
  'upi_payee_name',
] as const;
type EditableKey = typeof EDITABLE_KEYS[number];

type NumericRange = { min: number; max: number; integer?: boolean };
const NUMERIC_RANGES: Partial<Record<EditableKey, NumericRange>> = {
  recharge_credit_percent: { min: 50, max: 100, integer: true },
  min_recharge_paise:      { min: 1000, max: 500_000 },
  included_credit_paise:   { min: 1, max: 10_000_000 },
  low_balance_paise:       { min: 100, max: 1_000_000 },
  daily_ai_cap_paise:      { min: 1000, max: 1_000_000 },
};
const STRING_KEYS: EditableKey[] = ['upi_vpa', 'upi_payee_name'];

export async function GET(request: NextRequest) {
  const dev = await requireDeveloperUser(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = createServiceClient() as any;
  try {
    const { data: cfgRows, error: cfgErr } = await db
      .from('app_config')
      .select('key, value')
      .in('key', [...EDITABLE_KEYS]);
    if (cfgErr) throw cfgErr;

    const { data: rateRows, error: rateErr } = await db
      .from('ai_rate_card')
      .select('feature, unit, paise_per_unit')
      .order('feature');
    if (rateErr) throw rateErr;

    const config: Record<string, unknown> = {};
    for (const r of cfgRows ?? []) config[r.key] = r.value;

    return NextResponse.json({
      config,
      rate_card: (rateRows ?? []).map((r: any) => ({
        feature:        r.feature,
        unit:           r.unit,
        paise_per_unit: Number(r.paise_per_unit),
      })),
    });
  } catch (err) {
    await logServerError('api/admin/config GET', err, { developerId: dev.id });
    return NextResponse.json({ error: 'Could not load config.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const dev = await requireDeveloperUser(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }

  const db = createServiceClient() as any;

  try {
    if (body.type === 'config') {
      const key = typeof body.key === 'string' ? body.key as EditableKey : null;
      if (!key || !EDITABLE_KEYS.includes(key)) {
        return NextResponse.json({ error: 'Unknown config key.' }, { status: 400 });
      }

      if (STRING_KEYS.includes(key)) {
        const val = typeof body.value === 'string' ? body.value.trim() : '';
        if (!val) return NextResponse.json({ error: 'Value cannot be empty.' }, { status: 400 });
        // Never log UPI values
        const { error } = await db
          .from('app_config')
          .upsert({ key, value: JSON.stringify(val), updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      const range = NUMERIC_RANGES[key];
      if (!range) return NextResponse.json({ error: 'Unknown config key.' }, { status: 400 });

      const num = Number(body.value);
      if (!Number.isFinite(num)) {
        return NextResponse.json({ error: 'Value must be a number.' }, { status: 400 });
      }
      if (range.integer && !Number.isInteger(num)) {
        return NextResponse.json({ error: 'Value must be a whole number.' }, { status: 400 });
      }
      if (num < range.min || num > range.max) {
        return NextResponse.json(
          { error: `Value must be between ${range.min} and ${range.max}.` },
          { status: 400 }
        );
      }

      const { error } = await db
        .from('app_config')
        .upsert({ key, value: num, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.type === 'rate_card') {
      const feature = typeof body.feature === 'string' ? body.feature.trim() : '';
      if (!feature) return NextResponse.json({ error: 'Feature name is required.' }, { status: 400 });
      const ppu = Number(body.paise_per_unit);
      if (!Number.isFinite(ppu) || ppu < 0) {
        return NextResponse.json({ error: 'Rate must be a non-negative number.' }, { status: 400 });
      }
      const { error } = await db
        .from('ai_rate_card')
        .update({ paise_per_unit: ppu, updated_at: new Date().toISOString() })
        .eq('feature', feature);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown type.' }, { status: 400 });
  } catch (err) {
    await logServerError('api/admin/config POST', err, { developerId: dev.id, type: body.type, key: body.key });
    return NextResponse.json({ error: 'Could not save config. Please try again.' }, { status: 500 });
  }
}

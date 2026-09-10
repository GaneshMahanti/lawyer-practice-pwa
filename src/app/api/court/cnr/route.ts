import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';

const CNR_PATTERN = /^[A-Z]{4}\d{2}\d{4}\d{6}$/i;

export async function POST(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Court lookup is limited to approved advocates.' }, { status: 403 });
  }

  let cnr = '';
  try {
    const body = await request.json();
    cnr = String(body.cnr || '').replace(/\s+/g, '').toUpperCase();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!CNR_PATTERN.test(cnr) && cnr.length !== 16) {
    return NextResponse.json({ error: 'Enter a 16-character CNR number.' }, { status: 400 });
  }

  return NextResponse.json({
    success: false,
    provider: 'ecourts_on_demand',
    cnr,
    message: 'On-demand CNR lookup is wired as an isolated module. No background scrape runs. Configure an eCourts data provider to return live status, next hearing, and history.',
  });
}

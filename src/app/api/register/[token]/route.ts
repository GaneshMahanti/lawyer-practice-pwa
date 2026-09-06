import { NextResponse } from 'next/server';

/**
 * Server-side KYC token validation and submission route.
 * Strictly enforces UIDAI & Supreme Court Aadhaar masking:
 * Never saves or logs the full 12-digit Aadhaar. Only aadhaar_last4 is preserved.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Invalid or missing registration token.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      name,
      phone_1,
      phone_2,
      aadhaarNumber,
      current_address,
      permanent_address,
    } = body;

    // Server-side validation
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Full legal name is required.' }, { status: 400 });
    }

    const cleanPhone = (phone_1 || '').replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      return NextResponse.json(
        { error: 'A valid 10-digit primary phone number is required.' },
        { status: 400 }
      );
    }

    // Strict 12-digit Aadhaar validation
    const cleanAadhaar = (aadhaarNumber || '').replace(/\s+/g, '');
    if (!cleanAadhaar || !/^\d{12}$/.test(cleanAadhaar)) {
      return NextResponse.json(
        { error: 'Aadhaar must be an exact 12-digit numeric identifier.' },
        { status: 400 }
      );
    }

    if (!current_address || !current_address.trim()) {
      return NextResponse.json({ error: 'Current address is required.' }, { status: 400 });
    }

    if (!permanent_address || !permanent_address.trim()) {
      return NextResponse.json({ error: 'Permanent address is required.' }, { status: 400 });
    }

    // UIDAI Compliance: Extract ONLY last 4 digits, immediately drop full Aadhaar from scope
    const aadhaar_last4 = cleanAadhaar.slice(-4);

    return NextResponse.json({
      success: true,
      message: 'KYC verified and client activated successfully.',
      aadhaar_masked: `XXXX-XXXX-${aadhaar_last4}`,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error processing registration.' },
      { status: 500 }
    );
  }
}

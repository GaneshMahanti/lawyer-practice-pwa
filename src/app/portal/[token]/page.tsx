/**
 * Client Portal — KYC Registration Page
 * Server Component: validates token server-side before rendering any form.
 * Never queries main app tables (clients, matters, etc.) directly.
 * All data comes from portal_invites.fee_snapshot (denormalized at invite time).
 */
import { createServiceClient } from '@/lib/supabase/service';
import { createHash } from 'crypto';
import PortalForm from './PortalForm';

interface PageProps {
  params: Promise<{ token: string }>;
}

type PortalInvite = {
  id: string;
  advocate_name: string;
  fee_snapshot: Array<{ fee_type: string; amount: number; razorpay_link_url: string | null }>;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
};

async function validateToken(rawToken: string): Promise<
  | { ok: true; invite: PortalInvite }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'used' | 'service_unavailable' }
> {
  let supabase;
  try {
    supabase = createServiceClient();
  } catch {
    return { ok: false, reason: 'service_unavailable' };
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const { data, error } = await supabase
    .from('portal_invites')
    .select('id, advocate_name, fee_snapshot, expires_at, revoked_at, used_at')
    .eq('token_hash', tokenHash)
    .single();

  if (error || !data) return { ok: false, reason: 'invalid' };

  const invite = data as PortalInvite;

  if (invite.revoked_at) return { ok: false, reason: 'revoked' };
  if (invite.used_at) return { ok: false, reason: 'used' };
  if (new Date(invite.expires_at) < new Date()) return { ok: false, reason: 'expired' };

  return { ok: true, invite };
}

function ErrorScreen({ reason }: { reason: string }) {
  const messages: Record<string, { title: string; body: string }> = {
    invalid: { title: 'Invalid Link', body: 'This registration link is invalid. Please contact your advocate for a new link.' },
    expired: { title: 'Link Expired', body: 'This registration link has expired. Please contact your advocate to send a new link.' },
    revoked: { title: 'Link Revoked', body: 'This link has been revoked by your advocate. Please contact them for assistance.' },
    used: { title: 'Already Submitted', body: 'Your registration has already been submitted. Your advocate will be in touch shortly.' },
    service_unavailable: { title: 'Service Unavailable', body: 'The registration service is temporarily unavailable. Please try again later.' },
  };
  const msg = messages[reason] || messages.invalid;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg-app)', textAlign: 'center' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--status-danger)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 20 }} aria-hidden="true">
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>{msg.title}</h1>
      <p style={{ color: 'var(--text-secondary)', maxWidth: 340, lineHeight: 1.5, fontSize: '0.92rem' }}>{msg.body}</p>
    </div>
  );
}

export default async function PortalPage({ params }: PageProps) {
  const { token } = await params;

  if (!token || typeof token !== 'string' || token.length < 32) {
    return <ErrorScreen reason="invalid" />;
  }

  const result = await validateToken(token);

  if (!result.ok) {
    return <ErrorScreen reason={result.reason} />;
  }

  const nonZeroFees = result.invite.fee_snapshot.filter((f) => f.amount > 0);

  return (
    <PortalForm
      inviteId={result.invite.id}
      rawToken={token}
      advocateName={result.invite.advocate_name}
      fees={nonZeroFees}
    />
  );
}

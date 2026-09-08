/**
 * Client Portal — KYC Registration & Payment Page.
 * Server Component: validates opaque token server-side via SHA-256 hash.
 * Never queries main app tables (clients, matters, notes) directly.
 * All fee data comes from portal_invites.fee_snapshot.
 */
import React from 'react';
import { createServiceClient } from '@/lib/supabase/service';
import { createHash } from 'crypto';
import PortalForm from './PortalForm';
import { Lock, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { PortalInviteStatus } from '@/lib/types/database';

interface PageProps {
  params: Promise<{ token: string }>;
}

type PortalInvite = {
  id: string;
  advocate_name: string;
  client_name: string | null;
  status: PortalInviteStatus;
  fee_snapshot: Array<{ fee_type: string; amount: number; razorpay_link_url: string | null }>;
  expires_at: string;
  revoked_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
};

async function validateToken(rawToken: string): Promise<
  | { ok: true; invite: PortalInvite }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'service_unavailable' }
> {
  let supabase;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error('Portal service client unavailable:', err);
    return { ok: false, reason: 'service_unavailable' };
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const { data, error } = await (supabase as any)
    .from('portal_invites')
    .select('id, advocate_name, client_name, status, fee_snapshot, expires_at, revoked_at, submitted_at, completed_at')
    .eq('token_hash', tokenHash)
    .single();

  if (error || !data) return { ok: false, reason: 'invalid' };

  const invite = data as PortalInvite;

  // Revocation check
  if (invite.status === 'revoked' || invite.revoked_at) {
    return { ok: false, reason: 'revoked' };
  }

  // Expiration check
  if (invite.status === 'expired' || new Date(invite.expires_at) < new Date()) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, invite };
}

function ErrorScreen({ reason }: { reason: string }) {
  const messages: Record<string, { title: string; body: string }> = {
    invalid: {
      title: 'Invalid Link',
      body: 'This registration link is invalid. Please contact your advocate for an official invite.',
    },
    expired: {
      title: 'Link Expired',
      body: 'This registration link has expired. Please request a new invite link from your advocate.',
    },
    revoked: {
      title: 'Link Revoked',
      body: 'This link has been revoked by your advocate. Please contact their office for assistance.',
    },
    service_unavailable: {
      title: 'Service Configuration Error',
      body: 'The secure client portal service is currently not configured on the server. Please contact your advocate to verify backend settings.',
    },
  };
  const msg = messages[reason] || messages.invalid;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'var(--bg-app)',
      textAlign: 'center',
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: 14,
        background: 'rgba(220,50,50,0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--status-danger)',
        marginBottom: 20,
      }}>
        <AlertTriangle size={28} />
      </div>
      <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>
        {msg.title}
      </h1>
      <p style={{ color: 'var(--text-secondary)', maxWidth: 360, lineHeight: 1.5, fontSize: '0.92rem' }}>
        {msg.body}
      </p>
    </div>
  );
}

function CompletedScreen({ advocateName }: { advocateName: string }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'var(--bg-app)',
      textAlign: 'center',
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: 14,
        background: 'rgba(34,197,94,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--status-success)',
        marginBottom: 20,
      }}>
        <ShieldCheck size={32} />
      </div>
      <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>
        Registration & Payment Complete
      </h1>
      <p style={{ color: 'var(--text-secondary)', maxWidth: 360, lineHeight: 1.5, fontSize: '0.92rem' }}>
        Thank you. Your onboarding and payments have been successfully recorded with <strong>{advocateName}</strong>.
      </p>
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

  const invite = result.invite;

  // If the complete onboarding and payment workflow is already completed
  if (invite.status === 'completed') {
    return <CompletedScreen advocateName={invite.advocate_name} />;
  }

  const nonZeroFees = invite.fee_snapshot.filter((f) => f.amount > 0);

  // Render KYC Form (or Payment Pending view if already submitted)
  return (
    <PortalForm
      inviteId={invite.id}
      rawToken={token}
      advocateName={invite.advocate_name}
      fees={nonZeroFees}
      initialStatus={invite.status}
    />
  );
}

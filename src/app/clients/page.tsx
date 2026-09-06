'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/context';
import {
  loadClients,
  saveClients,
  loadClientFees,
  createClientInvite,
  type InviteClientResult,
} from '@/lib/data/repository';
import type { Client, ClientFee } from '@/lib/types/database';

export default function ClientsPage() {
  const { t } = useLanguage();

  const [clients, setClients] = useState<Client[]>([]);
  const [fees, setFees] = useState<ClientFee[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'pending'>('active');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal states
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showDirectAddModal, setShowDirectAddModal] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteClientResult | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Invite form fields
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [consultationFee, setConsultationFee] = useState('');
  const [legalNoticeFee, setLegalNoticeFee] = useState('');
  const [caseFee, setCaseFee] = useState('');

  // Direct add fields
  const [directName, setDirectName] = useState('');
  const [directPhone, setDirectPhone] = useState('');
  const [directPhone2, setDirectPhone2] = useState('');
  const [directEmail, setDirectEmail] = useState('');
  const [directCaseRef, setDirectCaseRef] = useState('');
  const [directCurrentAddr, setDirectCurrentAddr] = useState('');
  const [directPermAddr, setDirectPermAddr] = useState('');
  const [directAadhaar, setDirectAadhaar] = useState('');

  const refreshData = () => {
    setClients(loadClients());
    setFees(loadClientFees());
  };

  useEffect(() => {
    refreshData();
    const handleUpdate = () => refreshData();
    window.addEventListener('vakildesk-clients-update', handleUpdate);
    return () => window.removeEventListener('vakildesk-clients-update', handleUpdate);
  }, []);

  // Filter clients
  const activeClients = clients.filter(
    (c) =>
      c.status === 'active' &&
      (c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phone.includes(searchQuery) ||
        (c.case_reference && c.case_reference.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  const pendingClients = clients.filter((c) => c.status === 'pending');

  const handleGenerateInvite = (e: React.FormEvent) => {
    e.preventDefault();

    const cFee = parseFloat(consultationFee) || 0;
    const lFee = parseFloat(legalNoticeFee) || 0;
    const csFee = parseFloat(caseFee) || 0;

    const result = createClientInvite({
      provisionalName: inviteName.trim() || undefined,
      phone: invitePhone.trim() || undefined,
      fees: {
        consultation: cFee > 0 ? cFee : undefined,
        legal_notice: lFee > 0 ? lFee : undefined,
        case_fee: csFee > 0 ? csFee : undefined,
      },
    });

    setInviteResult(result);
    refreshData();
  };

  const handleCopyInviteUrl = (url: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const getWhatsAppShareUrl = (url: string, name?: string) => {
    const text = name && name !== 'Prospective Client'
      ? `Dear ${name}, please complete your onboarding registration and KYC verification with Advocate representation here: ${url}`
      : `Dear Client, please complete your onboarding registration and KYC verification with Advocate representation here: ${url}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  const handleDirectAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directName.trim() || !directPhone.trim()) return;

    // Extract only last 4 digits of Aadhaar
    const rawAadhaar = directAadhaar.replace(/\s+/g, '');
    const aadhaar_last4 = rawAadhaar.length >= 4 ? rawAadhaar.slice(-4) : null;

    const newClient: Client = {
      id: `cli_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      owner_id: 'owner_current',
      name: directName.trim(),
      phone: directPhone.trim(),
      phone_2: directPhone2.trim() || null,
      email: directEmail.trim() || null,
      case_reference: directCaseRef.trim() || null,
      notes: null,
      whatsapp_opt_in: true,
      whatsapp_opt_in_at: new Date().toISOString(),
      preferred_language: 'en',
      status: 'active',
      registration_token: null,
      token_expires_at: null,
      aadhaar_last4,
      current_address: directCurrentAddr.trim() || null,
      permanent_address: directPermAddr.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const currentList = loadClients();
    currentList.unshift(newClient);
    saveClients(currentList);

    // Reset direct add modal
    setDirectName('');
    setDirectPhone('');
    setDirectPhone2('');
    setDirectEmail('');
    setDirectCaseRef('');
    setDirectCurrentAddr('');
    setDirectPermAddr('');
    setDirectAadhaar('');
    setShowDirectAddModal(false);
    refreshData();
  };

  return (
    <div>
      <div className="section-label">{t('clients')}</div>

      {/* Action Bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className="action-btn action-btn-primary"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => {
            setInviteResult(null);
            setInviteName('');
            setInvitePhone('');
            setConsultationFee('');
            setLegalNoticeFee('');
            setCaseFee('');
            setShowInviteModal(true);
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" x2="19" y1="8" y2="14" />
            <line x1="22" x2="16" y1="11" y2="11" />
          </svg>
          <span>Invite Client (WhatsApp)</span>
        </button>

        <button
          type="button"
          className="action-btn"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => setShowDirectAddModal(true)}
        >
          <span>+ Add Directly</span>
        </button>
      </div>

      {/* Tab Switcher: Active Clients vs Pending Invites */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button
          type="button"
          className={`action-btn ${activeTab === 'active' ? 'action-btn-primary' : ''}`}
          style={{ flex: 1, justifyContent: 'center', fontSize: '0.88rem' }}
          onClick={() => setActiveTab('active')}
        >
          Active Clients ({activeClients.length})
        </button>
        <button
          type="button"
          className={`action-btn ${activeTab === 'pending' ? 'action-btn-primary' : ''}`}
          style={{ flex: 1, justifyContent: 'center', fontSize: '0.88rem' }}
          onClick={() => setActiveTab('pending')}
        >
          Pending Invites ({pendingClients.length})
        </button>
      </div>

      {/* Search Input (for active tab) */}
      {activeTab === 'active' && (
        <div style={{ marginBottom: 14 }}>
          <input
            type="text"
            className="input-field"
            placeholder="Search by name, phone, or case ref…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ margin: 0 }}
          />
        </div>
      )}

      {/* ── Tab Content: Active Clients ── */}
      {activeTab === 'active' && (
        <div>
          {activeClients.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                {searchQuery ? 'No clients match your search.' : 'No active clients yet. Invite a client or add directly above.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {activeClients.map((c) => (
                <div key={c.id} className="card" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                        {c.name}
                      </div>
                      {c.case_reference && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 500, marginTop: 2 }}>
                          Case Ref: {c.case_reference}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: '0.72rem', padding: '3px 8px', borderRadius: 999, backgroundColor: 'var(--status-success-bg)', color: 'var(--status-success)', fontWeight: 600 }}>
                      Active
                    </span>
                  </div>

                  {/* Phone numbers */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>📞 Phone 1:</span>
                      <a href={`tel:${c.phone}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 600 }}>
                        {c.phone}
                      </a>
                    </div>
                    {c.phone_2 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>📱 Phone 2:</span>
                        <a href={`tel:${c.phone_2}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                          {c.phone_2}
                        </a>
                      </div>
                    )}
                  </div>

                  {/* KYC & Aadhaar Masking */}
                  <div style={{ backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 8, padding: '8px 10px', fontSize: '0.8rem', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Aadhaar (Masked):</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {c.aadhaar_last4 ? `XXXX-XXXX-${c.aadhaar_last4}` : 'Not provided'}
                      </span>
                    </div>
                    {c.current_address && (
                      <div style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                        📍 {c.current_address}
                      </div>
                    )}
                  </div>

                  {/* Quick Action Buttons */}
                  <div style={{ display: 'flex', gap: 8, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                    <a
                      href={`tel:${c.phone}`}
                      className="action-btn"
                      style={{ flex: 1, justifyContent: 'center', padding: '6px 12px', fontSize: '0.82rem', textDecoration: 'none' }}
                    >
                      📞 Call
                    </a>
                    <a
                      href={`https://wa.me/91${c.phone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="action-btn"
                      style={{ flex: 1, justifyContent: 'center', padding: '6px 12px', fontSize: '0.82rem', textDecoration: 'none', color: '#25D366' }}
                    >
                      💬 WhatsApp
                    </a>
                    <Link
                      href={`/matters?client=${c.id}`}
                      className="action-btn action-btn-primary"
                      style={{ flex: 1, justifyContent: 'center', padding: '6px 12px', fontSize: '0.82rem', textDecoration: 'none' }}
                    >
                      Cases →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Content: Pending Invites ── */}
      {activeTab === 'pending' && (
        <div>
          {pendingClients.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                No pending registration links. Tap "Invite Client" to generate a shareable onboarding link.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingClients.map((c) => {
                const origin = typeof window !== 'undefined' ? window.location.origin : '';
                const regUrl = `${origin}/register/${c.registration_token}`;
                const clientFees = fees.filter((f) => f.client_id === c.id);
                const totalFees = clientFees.reduce((acc, f) => acc + f.amount, 0);

                return (
                  <div key={c.id} className="card" style={{ marginBottom: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                          {c.name}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Invited on {new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.72rem', padding: '3px 8px', borderRadius: 999, backgroundColor: 'var(--status-warning-bg)', color: 'var(--status-warning)', fontWeight: 600 }}>
                        ⏳ Awaiting KYC
                      </span>
                    </div>

                    {/* Fees attached */}
                    {totalFees > 0 && (
                      <div style={{ margin: '6px 0 10px', fontSize: '0.84rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                        Scheduled Fees: ₹{totalFees.toLocaleString('en-IN')}
                      </div>
                    )}

                    {/* Link action */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button
                        type="button"
                        className="action-btn"
                        style={{ flex: 1, justifyContent: 'center', fontSize: '0.82rem' }}
                        onClick={() => handleCopyInviteUrl(regUrl)}
                      >
                        📋 Copy Link
                      </button>
                      <a
                        href={getWhatsAppShareUrl(regUrl, c.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="action-btn action-btn-primary"
                        style={{ flex: 1, justifyContent: 'center', fontSize: '0.82rem', textDecoration: 'none' }}
                      >
                        💬 Share on WhatsApp
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modal: Invite Client Flow ── */}
      {showInviteModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 440,
              maxHeight: '90vh',
              overflowY: 'auto',
              marginBottom: 0,
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                {inviteResult ? 'Share Onboarding Link' : 'Invite Client (WhatsApp)'}
              </div>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.4rem', cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            {!inviteResult ? (
              <form onSubmit={handleGenerateInvite}>
                <label className="input-label">Client Name (Optional/Provisional)</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Srikanth Rao"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />

                <label className="input-label">Phone Number (Optional)</label>
                <input
                  type="tel"
                  className="input-field"
                  placeholder="e.g. 9876543210"
                  value={invitePhone}
                  onChange={(e) => setInvitePhone(e.target.value)}
                />

                {/* Fees Section */}
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 4 }}>
                    Prescribed Legal Fees (Optional)
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                    Any fee left at ₹0 or blank will NOT appear on the client-facing page at all.
                  </div>

                  <label className="input-label">Consultation Fee (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    className="input-field"
                    placeholder="0"
                    value={consultationFee}
                    onChange={(e) => setConsultationFee(e.target.value)}
                  />

                  <label className="input-label">Legal Notice Fee (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    className="input-field"
                    placeholder="0"
                    value={legalNoticeFee}
                    onChange={(e) => setLegalNoticeFee(e.target.value)}
                  />

                  <label className="input-label">Case / Retainer Fee (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    className="input-field"
                    placeholder="0"
                    value={caseFee}
                    onChange={(e) => setCaseFee(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="action-btn action-btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
                >
                  Generate Shareable Link →
                </button>
              </form>
            ) : (
              <div>
                <div style={{ textAlign: 'center', padding: '12px 0 16px' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🔗</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                    Registration Token Generated
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Single-use link valid for 72 hours. Automatically expires upon submission.
                  </div>
                </div>

                {inviteResult.totalFeeAmount > 0 && (
                  <div style={{ backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Non-Zero Prescribed Fees:</div>
                    {inviteResult.fees.map((f) => (
                      <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: 4 }}>
                        <span style={{ textTransform: 'capitalize' }}>{f.fee_type.replace('_', ' ')}</span>
                        <span style={{ fontWeight: 600 }}>₹{f.amount.toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>Total</span>
                      <span style={{ color: 'var(--accent-primary)' }}>₹{inviteResult.totalFeeAmount.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                )}

                {/* Link Box */}
                <div
                  style={{
                    backgroundColor: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    fontSize: '0.78rem',
                    color: 'var(--text-secondary)',
                    wordBreak: 'break-all',
                    marginBottom: 14,
                  }}
                >
                  {inviteResult.registrationUrl}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <a
                    href={getWhatsAppShareUrl(inviteResult.registrationUrl, inviteResult.client.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="action-btn action-btn-primary"
                    style={{ justifyContent: 'center', textDecoration: 'none', padding: '12px 16px', fontSize: '0.95rem' }}
                  >
                    💬 One-Tap Share on WhatsApp
                  </a>

                  <button
                    type="button"
                    className="action-btn"
                    style={{ justifyContent: 'center' }}
                    onClick={() => handleCopyInviteUrl(inviteResult.registrationUrl)}
                  >
                    {copiedLink ? '✓ Copied Link to Clipboard!' : '📋 Copy Link'}
                  </button>

                  <button
                    type="button"
                    className="action-btn"
                    style={{ justifyContent: 'center' }}
                    onClick={() => setShowInviteModal(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: Direct Add Client ── */}
      {showDirectAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 440,
              maxHeight: '90vh',
              overflowY: 'auto',
              marginBottom: 0,
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                Add Client Directly
              </div>
              <button
                type="button"
                onClick={() => setShowDirectAddModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.4rem', cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDirectAdd}>
              <label className="input-label">Full Name *</label>
              <input
                type="text"
                className="input-field"
                placeholder="Client legal name"
                required
                value={directName}
                onChange={(e) => setDirectName(e.target.value)}
              />

              <label className="input-label">Phone No. 1 (Primary) *</label>
              <input
                type="tel"
                className="input-field"
                placeholder="10-digit mobile number"
                required
                value={directPhone}
                onChange={(e) => setDirectPhone(e.target.value)}
              />

              <label className="input-label">Secondary Phone No.</label>
              <input
                type="tel"
                className="input-field"
                placeholder="Alternate phone number"
                value={directPhone2}
                onChange={(e) => setDirectPhone2(e.target.value)}
              />

              <label className="input-label">Case Reference / File No.</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. CRL-2026-042"
                value={directCaseRef}
                onChange={(e) => setDirectCaseRef(e.target.value)}
              />

              <label className="input-label">Aadhaar (12 digits, stored masked)</label>
              <input
                type="text"
                className="input-field"
                placeholder="XXXX XXXX 1234"
                value={directAadhaar}
                onChange={(e) => setDirectAadhaar(e.target.value)}
              />

              <label className="input-label">Current Address</label>
              <textarea
                className="input-field"
                rows={2}
                placeholder="Current residence address"
                value={directCurrentAddr}
                onChange={(e) => setDirectCurrentAddr(e.target.value)}
              />

              <button
                type="submit"
                className="action-btn action-btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
              >
                Save Client Record
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

interface AuditEntry {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: string;
  created_at: string;
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setEmail(user.email || null);
          setRole((user.app_metadata?.role as string) || null);
        }

        // Fetch audit logs if table exists
        const { data } = await (supabase as any)
          .from('audit_logs')
          .select('id, action, resource_type, resource_id, outcome, created_at')
          .order('created_at', { ascending: false })
          .limit(20);

        if (data) {
          setAuditLogs(data);
        }
      } catch (err) {
        console.error('Error fetching admin data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading developer portal…
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Developer Operations
          </h1>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 2 }}>
            Authenticated: {email} | Role: {role || 'none'}
          </div>
        </div>
        <Link href="/app" className="action-btn" style={{ fontSize: '0.82rem' }}>
          ← Back to App
        </Link>
      </div>

      <div className="card" style={{ borderColor: 'var(--accent-gold, #c8a03c)' }}>
        <div className="card-title" style={{ color: 'var(--accent-gold, #c8a03c)' }}>
          Security & Access Status
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <div>🛡️ <strong>RBAC Middleware:</strong> Active (Enforcing developer vs lawyer routes)</div>
          <div>🔒 <strong>PostgreSQL RLS:</strong> Stamped via <code>auth.users.raw_app_meta_data</code></div>
          <div>🌐 <strong>Client KYC Isolation:</strong> Handled via opaque hashes in <code>/portal/[token]</code></div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Recent Audit Trail</div>
        {auditLogs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '12px 0' }}>
            No audit log entries recorded yet in Supabase.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {auditLogs.map((log) => (
              <div
                key={log.id}
                style={{
                  padding: '8px 12px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 8,
                  fontSize: '0.82rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                  <span>{log.action} ({log.resource_type})</span>
                  <span style={{ color: log.outcome === 'success' ? 'var(--status-success)' : 'var(--status-danger)' }}>
                    {log.outcome}
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginTop: 2 }}>
                  {new Date(log.created_at).toLocaleString('en-IN')} • ID: {log.resource_id}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

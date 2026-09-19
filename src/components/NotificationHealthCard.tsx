'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface LogResponse {
  setupMissing: boolean;
  heartbeat: { last_run_at: string; detail: Record<string, number> } | null;
  deliveries: Array<{
    id: string;
    owner_id: string;
    booking_id: string;
    offset_minutes: number;
    status: 'sending' | 'sent' | 'failed';
    attempt_count: number;
    devices_reached: number;
    error_summary: string | null;
    updated_at: string;
  }>;
  errors: Array<{ id: string; created_at: string; scope: string; message: string }>;
  deviceCount: number;
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/** Developer dashboard card: is the reminder scheduler alive, what was sent, what failed. */
export function NotificationHealthCard() {
  const [data, setData] = useState<LogResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch('/api/admin/notification-log');
      if (!res.ok) throw new Error('request failed');
      setData(await res.json());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const beatAge = data?.heartbeat ? minutesAgo(data.heartbeat.last_run_at) : null;
  const schedulerHealthy = beatAge !== null && beatAge <= 15;

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Notification health</span>
        <button
          type="button"
          className="action-btn"
          style={{ fontSize: '0.75rem', padding: '4px 10px' }}
          onClick={load}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {failed && (
        <div style={{ color: 'var(--status-danger)', fontSize: '0.82rem' }}>Could not load notification status.</div>
      )}

      {data?.setupMissing && (
        <div style={{ color: 'var(--status-warning)', fontSize: '0.82rem', marginBottom: 8 }}>
          Notification tables are missing. Run supabase/migration_phase6_reminders_shortlinks.sql in the Supabase SQL editor.
        </div>
      )}

      {data && !data.setupMissing && (
        <>
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: '0.84rem',
              fontWeight: 600,
              marginBottom: 10,
              background: schedulerHealthy ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
              color: schedulerHealthy ? 'var(--status-success)' : 'var(--status-danger)',
            }}
          >
            {beatAge === null
              ? 'Scheduler has never run. Reminders will NOT be sent until it is set up.'
              : schedulerHealthy
              ? `Scheduler OK. Last run ${beatAge} min ago.`
              : `Scheduler STOPPED. Last run ${beatAge} min ago. Reminders are not being sent.`}
          </div>

          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
            Devices with notifications on: <strong>{data.deviceCount}</strong>
          </div>

          <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
            Recent reminders
          </div>
          {data.deliveries.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10 }}>None yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              {data.deliveries.map((d) => (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: '0.78rem',
                    padding: '5px 8px',
                    borderRadius: 6,
                    background: 'var(--bg-surface-elevated)',
                  }}
                >
                  <span>
                    {d.offset_minutes} min before · {d.devices_reached} device(s)
                    {d.error_summary ? ` · ${d.error_summary}` : ''}
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      color:
                        d.status === 'sent'
                          ? 'var(--status-success)'
                          : d.status === 'failed'
                          ? 'var(--status-danger)'
                          : 'var(--status-warning)',
                    }}
                  >
                    {d.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
            Recent errors
          </div>
          {data.errors.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>None.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {data.errors.map((e) => (
                <div
                  key={e.id}
                  style={{ fontSize: '0.76rem', padding: '5px 8px', borderRadius: 6, background: 'var(--bg-surface-elevated)' }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {e.scope} · {new Date(e.created_at).toLocaleString('en-IN')}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{e.message}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

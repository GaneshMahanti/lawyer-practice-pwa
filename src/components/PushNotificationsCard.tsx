'use client';

import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { getWorkspaceState } from '@/lib/data/workspace';
import {
  NOTIFICATION_ERROR_TEXT,
  disablePush,
  enablePush,
  getPushState,
  reportPushError,
  sendTestPush,
  type PushState,
} from '@/lib/push/client';

/** Settings card: turn hearing notifications on/off for this device and send a test. */
export function PushNotificationsCard() {
  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const isDemo = getWorkspaceState().isDemo;

  useEffect(() => {
    let cancelled = false;
    getPushState().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (stage: string, action: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    setInfo(null);
    try {
      await action();
    } catch (err) {
      reportPushError(stage, err);
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = () =>
    run('enable', async () => {
      setState(await enablePush());
    });

  const handleDisable = () =>
    run('disable', async () => {
      await disablePush();
      setState(await getPushState());
    });

  const handleTest = () =>
    run('test', async () => {
      const ok = await sendTestPush();
      if (!ok) throw new Error('test notification request failed');
      setInfo('Test sent. It should appear on this device in a few seconds.');
    });

  const message: Record<Exclude<PushState, 'loading' | 'off' | 'on'>, string> = {
    unsupported:
      "This browser can't show notifications. Use Chrome on Android, or the installed VakilDesk app on iPhone.",
    'needs-install':
      'On iPhone, first add VakilDesk to your Home Screen (Share, then Add to Home Screen). Open it from there, then return here to turn notifications on.',
    unconfigured: 'Notifications are not set up on the server yet.',
    blocked:
      "Notifications are blocked for VakilDesk. Allow them in your phone's browser or app settings, then reopen this page.",
  };

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Bell size={18} color="var(--accent-primary)" aria-hidden="true" />
        <span>Hearing notifications</span>
      </div>

      {isDemo ? (
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
          Notifications are not available in demo mode.
        </p>
      ) : state === 'loading' ? (
        <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: 0 }}>Checking…</p>
      ) : state === 'off' || state === 'on' ? (
        <>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.45 }}>
            {state === 'on'
              ? 'On for this device. You will get a notification before each hearing, even when the app is closed.'
              : 'Get a notification on this phone before each hearing, even when the app is closed.'}
          </p>
          {state === 'off' ? (
            <button
              type="button"
              className="action-btn action-btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={handleEnable}
              disabled={busy}
            >
              {busy ? 'Turning on…' : 'Turn on notifications'}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="action-btn action-btn-primary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={handleTest}
                disabled={busy}
              >
                {busy ? 'Sending…' : 'Send test notification'}
              </button>
              <button
                type="button"
                className="action-btn"
                style={{ justifyContent: 'center' }}
                onClick={handleDisable}
                disabled={busy}
              >
                Turn off
              </button>
            </div>
          )}
        </>
      ) : (
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
          {message[state]}
        </p>
      )}

      {info && (
        <p style={{ fontSize: '0.8rem', color: 'var(--status-success)', margin: '10px 0 0' }}>{info}</p>
      )}
      {error && (
        <p role="alert" style={{ fontSize: '0.8rem', color: 'var(--status-danger)', margin: '10px 0 0' }}>
          {NOTIFICATION_ERROR_TEXT}
        </p>
      )}
    </div>
  );
}

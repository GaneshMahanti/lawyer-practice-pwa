'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const allowed =
      process.env.NODE_ENV === 'production' ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost';
    if (!allowed) return;

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('VakilDesk Service Worker active:', reg.scope);
        })
        .catch((err) => {
          console.warn('VakilDesk Service Worker registration failed:', err);
        });
    };

    // React can finish hydrating AFTER the window "load" event has already fired.
    // Waiting for a "load" that never comes would leave the worker (and push) unregistered.
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}

'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      (process.env.NODE_ENV === 'production' || window.location.protocol === 'https:' || window.location.hostname === 'localhost')
    ) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => {
            console.log('VakilDesk Service Worker active:', reg.scope);
          })
          .catch((err) => {
            console.warn('VakilDesk Service Worker registration failed:', err);
          });
      });
    }
  }, []);

  return null;
}

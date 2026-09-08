import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { LanguageProvider } from '@/lib/i18n/context';
import { ThemeProvider } from '@/lib/theme/context';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'VakilDesk — Legal Practice Management',
  description: 'Mobile practice management for advocates in India.',
  applicationName: 'VakilDesk',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'VakilDesk',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icons/icon-192.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
  formatDetection: {
    telephone: true,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f0f18' },
    { media: '(prefers-color-scheme: light)', color: '#1a3a6b' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icons/icon-192.png" type="image/png" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body suppressHydrationWarning>
        <ServiceWorkerRegister />
        <ThemeProvider>
          <LanguageProvider>
            {children}
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

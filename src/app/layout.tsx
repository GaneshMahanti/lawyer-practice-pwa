import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { LanguageProvider } from '@/lib/i18n/context';
import { Header } from '@/components/Header';
import { BottomNav } from '@/components/BottomNav';

export const metadata: Metadata = {
  title: 'VakilDesk — Legal Practice Management',
  description: 'Mobile practice management for advocates in India.',
  applicationName: 'VakilDesk',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'VakilDesk',
  },
  formatDetection: {
    telephone: true,
  },
};

export const viewport: Viewport = {
  themeColor: '#1e293b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icons/icon-192.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      </head>
      <body>
        <LanguageProvider>
          <div className="app-container">
            <Header />
            <main className="main-content">{children}</main>
            <BottomNav />
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}

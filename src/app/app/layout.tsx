import React from 'react';
import { Header } from '@/components/Header';
import { BottomNav } from '@/components/BottomNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-container">
      <Header />
      <main className="main-content">{children}</main>
      <BottomNav />
    </div>
  );
}

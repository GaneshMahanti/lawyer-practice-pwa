import React from 'react';
import { Header } from '@/components/Header';
import { BottomNav } from '@/components/BottomNav';
import { WorkspaceProvider } from '@/components/WorkspaceProvider';
import { DemoBanner } from '@/components/DemoBanner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <div className="app-container">
        <DemoBanner />
        <Header />
        <main className="main-content">{children}</main>
        <BottomNav />
      </div>
    </WorkspaceProvider>
  );
}

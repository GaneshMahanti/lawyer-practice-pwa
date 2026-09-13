import React from 'react';
import { Header } from '@/components/Header';
import { BottomNav } from '@/components/BottomNav';
import { WorkspaceProvider } from '@/components/WorkspaceProvider';
import { DemoBanner } from '@/components/DemoBanner';
import { AuraBackground } from '@/components/AuraBackground';

/**
 * Liquid Glass app shell.
 * The <AuraBackground /> sits at z-index 0 behind the whole app so glass
 * cards throughout the tree pick up its colour when they blur through.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <AuraBackground />
      <div className="app-container">
        <DemoBanner />
        <Header />
        <main className="main-content">{children}</main>
        <BottomNav />
      </div>
    </WorkspaceProvider>
  );
}

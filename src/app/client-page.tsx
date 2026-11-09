'use client';

import { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { closeLocalGui } from '@/lib/close-local-gui';
import './startup.css';

type StartupStage = 'welcome' | 'button-fading' | 'title-hold' | 'title-fading' | 'dashboard-fading' | 'dashboard';

const loadDashboard = () => import('@/components/dashboard/DashboardClient');
const DashboardClient = dynamic(loadDashboard, {
  loading: () => <div className="startup-dashboard-loading" aria-label="Loading dashboard" />,
  ssr: false,
});

export default function ClientPage() {
  const [stage, setStage] = useState<StartupStage>('welcome');
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');

  useEffect(() => {
    const next: Partial<Record<StartupStage, [number, StartupStage]>> = {
      'button-fading': [600, 'title-hold'],
      'title-hold': [5000, 'title-fading'],
      'title-fading': [850, 'dashboard-fading'],
      'dashboard-fading': [900, 'dashboard'],
    };
    const transition = next[stage];
    if (!transition) return;
    const timer = window.setTimeout(() => setStage(transition[1]), transition[0]);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const showWelcome = stage !== 'dashboard-fading' && stage !== 'dashboard';
  const showDashboard = !showWelcome;

  function startSequence() {
    if (stage !== 'welcome' || closing) return;
    void loadDashboard().catch(() => undefined); // Preload during the title hold.
    setStage('button-fading');
  }

  async function exitGui() {
    if (stage !== 'welcome' || closing) return;
    setClosing(true);
    setCloseError('');
    try {
      await closeLocalGui();
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : 'Could not close the local GUI.');
      setClosing(false);
    }
  }

  return (
    <div className="startup-shell">
      {showWelcome && (
        <main className="startup-welcome" aria-label="CARL welcome screen">
          <h1 className={`startup-title${stage === 'title-fading' ? ' startup-title-fading' : ''}`}>
            <span>Autonomous</span>
            <span>Systems</span>
            <span>Lab</span>
          </h1>
          <button type="button" className={`startup-button${stage !== 'welcome' ? ' startup-button-fading' : ''}`}
            onClick={startSequence} disabled={stage !== 'welcome' || closing}>
            Start CARL
          </button>
          <button type="button" className={`startup-exit${stage !== 'welcome' ? ' startup-exit-fading' : ''}`}
            onClick={() => void exitGui()} disabled={stage !== 'welcome' || closing}>
            {closing ? 'Closing…' : 'Exit GUI'}
          </button>
          {closeError && <p className="startup-close-error" role="alert">{closeError}</p>}
        </main>
      )}
      {showDashboard && (
        <div className={`startup-dashboard${stage === 'dashboard-fading' ? ' startup-dashboard-fading' : ''}`}>
          <Suspense fallback={<div className="startup-dashboard-loading" aria-label="Loading dashboard" />}>
            <DashboardClient />
          </Suspense>
        </div>
      )}
    </div>
  );
}

'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { closeLocalGui } from '@/lib/close-local-gui';
import './startup.css';

type Stage = 'welcome' | 'welcome-fading' | 'button-fading' | 'title-hold' | 'starting' | 'mode-select' | 'mode-fading' | 'preparing-no-control' | 'starting-joystick' | 'warning' | 'dashboard-fading' | 'dashboard' | 'stopping' | 'stop-fading' | 'error' | 'error-fading';
type Step = 'bridge' | 'rosbridge' | 'joystick';
type Mode = 'none' | 'joystick';
type Status = { state: 'off' | 'starting' | 'awaiting-mode' | 'joystick-starting' | 'joystick-stopping' | 'on' | 'stopping' | 'fault'; step: Step | null; mode: Mode | null; error: string | null };
const labels: Record<Step, string> = { bridge: 'Connecting CARL hardware', rosbridge: 'Starting telemetry connection', joystick: 'Starting joystick control' };
const loadDashboard = () => import('@/components/dashboard/DashboardClient');
const DashboardClient = dynamic(loadDashboard, { ssr: false, loading: () => <div className="startup-dashboard-loading" /> });

async function control(action?: 'start' | 'stop' | 'no-control' | 'start-joystick' | 'stop-joystick'): Promise<Status> {
  const response = await fetch('/api/carl-control', action
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }), cache: 'no-store' }
    : { cache: 'no-store' });
  const result = await response.json() as Status;
  if (!response.ok) throw new Error(result.error || 'CARL supervisor is unavailable. CARL is no longer operational.');
  return result;
}

export default function ClientPage() {
  const [stage, setStage] = useState<Stage>('welcome');
  const [step, setStep] = useState<Step>('bridge');
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [operationState, setOperationState] = useState<Status['state']>('off');
  const stopRequested = useRef(false);

  const applyStatus = useCallback((status: Status) => {
    setMode(status.mode);
    setOperationState(status.state);
    if (status.step) setStep(status.step);
    if (status.state === 'fault') { setError(status.error || 'Something went wrong. CARL is no longer operational.'); setStage(current => current === 'error-fading' || current === 'welcome-fading' ? current : 'error'); }
    else if (status.state === 'awaiting-mode') setStage(current => current === 'starting' ? 'mode-select' : current);
    else if (status.state === 'joystick-starting') setStage(current => current === 'mode-select' ? 'starting-joystick' : current);
    else if (status.state === 'on') setStage(current => {
      if (stopRequested.current) return current;
      if (current === 'error' || current === 'error-fading') return current;
      if (current === 'dashboard' || current === 'dashboard-fading' || current === 'warning') return current;
      if (current === 'mode-select' || current === 'mode-fading' || current === 'preparing-no-control' || current === 'starting-joystick') return 'warning';
      return 'dashboard-fading';
    });
    else if (status.state === 'off') setStage(current => {
      if (stopRequested.current) return current === 'stopping' ? 'stop-fading' : current;
      return ['welcome', 'welcome-fading', 'button-fading', 'title-hold', 'starting', 'error', 'error-fading'].includes(current) ? current : 'welcome-fading';
    });
  }, []);

  useEffect(() => {
    let alive = true, busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try { const status = await control(); if (alive) applyStatus(status); }
      catch (reason) { if (alive) { setError(reason instanceof Error ? reason.message : 'CARL supervisor is unavailable. CARL status is unknown; use the physical E-stop.'); setStage('error'); } }
      finally { busy = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [applyStatus]);

  useEffect(() => {
    const transitions: Partial<Record<Stage, [number, Stage]>> = {
      'button-fading': [600, 'title-hold'], 'title-hold': [2000, 'starting'], 'dashboard-fading': [900, 'dashboard'],
      'welcome-fading': [600, 'welcome'], 'warning': [5700, 'dashboard-fading'], 'stop-fading': [500, 'welcome-fading'],
    };
    const next = transitions[stage];
    if (!next) return;
    const timer = window.setTimeout(() => setStage(next[1]), next[0]);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'starting') return;
    void control('start').then(applyStatus).catch(reason => {
      setError(reason instanceof Error ? reason.message : 'CARL startup failed. CARL is no longer operational.');
      setStage('error');
    });
  }, [stage, applyStatus]);

  const stopCarl = useCallback(async () => {
    stopRequested.current = true;
    setStage('stopping');
    try {
      const status = await control('stop');
      if (status.state === 'off' || status.state === 'fault') applyStatus(status);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'CARL stop failed. Use the physical E-stop.'); setStage('error'); }
  }, [applyStatus]);

  async function chooseMode(selected: Mode) {
    setStage('mode-fading');
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      if (selected === 'none') {
        setStage('preparing-no-control');
        applyStatus(await control('no-control'));
      } else {
        setStage('starting-joystick');
        applyStatus(await control('start-joystick'));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Control mode could not be selected.');
      setStage('error');
    }
  }

  const changeJoystick = useCallback(async (action: 'start-joystick' | 'stop-joystick') => {
    try { applyStatus(await control(action)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Joystick mode could not be changed.'); setStage('error'); }
  }, [applyStatus]);

  const closeWithStop = useCallback(async () => {
    await control('stop');
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const status = await control();
      if (status.state === 'off') { await closeLocalGui(); return; }
      if (status.state === 'fault') throw new Error(status.error || 'CARL stop could not be verified. Use the physical E-stop.');
    }
    throw new Error('CARL did not stop in time. Use the physical E-stop.');
  }, []);

  async function returnFromError() {
    setStage('error-fading');
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      await control('stop');
      for (let attempt = 0; attempt < 20; attempt++) {
        const status = await control();
        if (status.state === 'off') { setError(''); setStage('welcome-fading'); return; }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('CARL did not stop in time. Use the physical E-stop.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'CARL stop could not be verified.');
      setStage('error');
    }
  }

  async function exitGui() {
    setClosing(true);
    try { await closeLocalGui(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not close the GUI.'); setClosing(false); }
  }

  const showDashboard = stage === 'dashboard' || stage === 'dashboard-fading';
  return <div className="startup-shell">
    {!showDashboard && <main className="startup-welcome" aria-label="CARL welcome screen">
      {stage !== 'error' && stage !== 'error-fading' && stage !== 'stopping' && <h1 className={`startup-title${stage === 'welcome-fading' ? ' startup-welcome-appearing' : ''}`}><span>Autonomous</span><span>Systems</span><span>Lab</span></h1>}
      {(stage === 'welcome' || stage === 'welcome-fading' || stage === 'button-fading') && <>
        <button type="button" className={`startup-button${stage === 'button-fading' ? ' startup-button-fading' : ''}${stage === 'welcome-fading' ? ' startup-welcome-appearing' : ''}`} disabled={closing || stage !== 'welcome'}
          onClick={() => { stopRequested.current = false; setError(''); void loadDashboard(); setStage('button-fading'); }}>Start CARL</button>
        <button type="button" className={`startup-exit${stage === 'button-fading' ? ' startup-exit-fading' : ''}${stage === 'welcome-fading' ? ' startup-welcome-appearing' : ''}`} disabled={closing || stage !== 'welcome'} onClick={() => void exitGui()}>{closing ? 'Closing…' : 'Exit GUI'}</button>
        {error && <p className="startup-close-error" role="alert">{error}</p>}
      </>}
      {(stage === 'starting' || stage === 'starting-joystick') && <div className="startup-progress" role="status" aria-live="polite">
        {(stage === 'starting' ? (['bridge', 'rosbridge'] as Step[]) : (['joystick'] as Step[])).map(item => <div className="startup-progress-row" key={item}>
          <span className="startup-progress-icon" aria-hidden="true">{step === item && <span className="startup-wave-bars"><i /><i /><i /><i /><i /></span>}</span><span>{labels[item]}</span>
        </div>)}
      </div>}
      {stage === 'preparing-no-control' && <div className="startup-progress" role="status" aria-live="polite">
        <div className="startup-progress-row"><span className="startup-progress-icon" aria-hidden="true"><span className="startup-wave-bars"><i /><i /><i /><i /><i /></span></span><span>Confirming zero throttle</span></div>
      </div>}
      {(stage === 'mode-select' || stage === 'mode-fading') && <div className={`startup-mode${stage === 'mode-fading' ? ' startup-mode-fading' : ''}`}>
        <h2>Choose a control mode</h2>
        <button disabled={stage !== 'mode-select'} onClick={() => void chooseMode('joystick')}>Joystick control</button>
        <button disabled={stage !== 'mode-select'} onClick={() => void chooseMode('none')}>No Control</button>
      </div>}
      {stage === 'warning' && <div className="startup-warning" role="alert">
        <h2>Before using CARL</h2>
        <p>If CARL moves unexpectedly or you are unsure of its movement state, press the physical E-stop button immediately.</p>
      </div>}
      {(stage === 'stopping' || stage === 'stop-fading') && <p className={`startup-message${stage === 'stop-fading' ? ' startup-message-fading' : ''}`} role="status">Stopping CARL control and software…</p>}
      {(stage === 'error' || stage === 'error-fading') && <div className={`startup-error${stage === 'error-fading' ? ' startup-error-fading' : ''}`} role="alert">
        <p>{error}</p><p>Use the physical E-stop if CARL moves or its state is uncertain.</p>
        <button disabled={stage === 'error-fading'} onClick={() => void returnFromError()}>Return to start</button>
      </div>}
    </main>}
    {showDashboard && <div className={`startup-dashboard${stage === 'dashboard-fading' ? ' startup-dashboard-fading' : ''}`}>
      <Suspense fallback={<div className="startup-dashboard-loading" aria-label="Loading dashboard" />}>
        <DashboardClient onStopCarl={() => void stopCarl()} onCloseLocalGui={closeWithStop}
          controlMode={mode} operationState={operationState}
          onStartJoystick={() => void changeJoystick('start-joystick')}
          onStopJoystick={() => void changeJoystick('stop-joystick')} />
      </Suspense>
    </div>}
  </div>;
}

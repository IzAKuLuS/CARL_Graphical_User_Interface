import { memo, type ReactNode } from 'react';
import { HEALTH_LABELS, type Health } from '../../../lib/passenger/dashboard';

export function Pedal({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 28 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 2h13l-7 27H4L11 2Z" /><path d="m13 8 6-2M11 15l6-2M9 22l6-2M3 30h17" />
  </svg>;
}

export function HealthDot({ value }: { value: Health }) {
  return <span className={`health-dot ${value}`} aria-hidden="true" />;
}

export function StatusIndicator({ icon, label, health, accessibleLabel }: {
  icon: ReactNode; label: string; health?: Health; accessibleLabel: string;
}) {
  return <span className="status-indicator" role="img" aria-label={accessibleLabel}>
    {icon}{health && <HealthDot value={health} />}<span>{label}</span>
  </span>;
}

export const Row = memo(function Row({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return <div className="detail-row"><div><span>{label}</span>{note && <small>{note}</small>}</div><strong>{value}</strong></div>;
});

export function HealthText({ value }: { value: Health }) {
  return <span className="health-text"><HealthDot value={value} />{HEALTH_LABELS[value]}</span>;
}


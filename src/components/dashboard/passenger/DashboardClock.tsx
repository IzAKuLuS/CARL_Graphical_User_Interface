'use client';
import { memo, useEffect, useMemo, useState } from 'react';

/** Updates only this component, once per minute. */
function DashboardClock({ hour24 }: { hour24: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  const format = useMemo(() => ({
    date: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: !hour24 })
  }), [hour24]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const sync = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(Math.floor(current / 60_000) * 60_000);
      if (!document.hidden) timer = setTimeout(sync, 60_000 - current % 60_000 + 50);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', sync); };
  }, []);
  const date = now === null ? '—' : format.date.format(now).toUpperCase();
  const time = now === null ? '—' : format.time.format(now);
  return <div className="clock" aria-label={`${date}, ${time}`}><span>{date}</span><time>{time}</time></div>;
}
export default memo(DashboardClock);

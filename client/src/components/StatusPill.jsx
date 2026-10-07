import React from 'react';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

/** Shared auto-refresh status banner used in the Dashboard and Accounts headers. */
export default function StatusPill({ status }) {
  if (!status) return null;
  const Icon = status.state === 'working' ? RefreshCw : status.state === 'error' ? AlertCircle : CheckCircle2;
  return (
    <p
      role="status"
      className={`anim-fade flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${
        status.state === 'error'
          ? 'bg-negative/10 text-negative'
          : status.state === 'working'
            ? 'bg-surfaceAlt text-muted'
            : 'bg-positive/10 text-positive'
      }`}
    >
      <Icon size={12} className={status.state === 'working' ? 'animate-spin' : undefined} />
      {status.text}
    </p>
  );
}

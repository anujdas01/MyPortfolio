import React from 'react';

export default function Spinner({ className = 'h-8 w-8' }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-spin rounded-full border-4 border-primary border-t-transparent ${className}`}
    />
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <Spinner className="h-12 w-12" />
    </div>
  );
}

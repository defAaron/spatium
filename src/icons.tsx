import type { ComponentProps, ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const PlayIcon = () => <Icon><path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" /></Icon>;
export const PauseIcon = () => <Icon><path d="M9 6v12M15 6v12" strokeWidth="2.2" /></Icon>;
export const TurnIcon = () => <Icon><path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v4.5h4.5" /></Icon>;
export const ResetIcon = () => <Icon><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></Icon>;
export const DownloadIcon = () => <Icon><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></Icon>;
export const ExpandIcon = () => <Icon><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Icon>;
export const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
export const MinusIcon = () => <Icon><path d="M5 12h14" /></Icon>;
export const ArrowIcon = () => <Icon><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const UploadIcon = () => <Icon><path d="M12 16V5M7 9.5l5-5 5 5M5 19h14" /></Icon>;
export const KeyIcon = () => <Icon><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2 2" /></Icon>;
export const ForwardIcon = () => <Icon><path d="M12 19V5M6 11l6-6 6 6" /></Icon>;

export function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={className ? `spinner ${className}` : 'spinner'} {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

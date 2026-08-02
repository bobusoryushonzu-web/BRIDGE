/** BACK-system 共通の UI 部品 */
import type { ReactNode } from 'react';

export function Spinner({ label = '読み込んでいます' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-stone-500">
      <div className="size-8 animate-spin rounded-full border-3 border-stone-300 border-t-stone-700" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800 ring-1 ring-red-200">
      {message}
    </div>
  );
}

export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-sm ${className}`}>{children}</div>
  );
}

export function Button({
  children,
  onClick,
  type = 'button',
  tone = 'primary',
  size = 'md',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  tone?: 'primary' | 'neutral' | 'danger' | 'success';
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const tones: Record<string, string> = {
    primary: 'bg-stone-800 text-white hover:bg-stone-700',
    neutral: 'bg-stone-100 text-stone-700 hover:bg-stone-200',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  };
  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl font-bold transition disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 ${tones[tone]} ${sizes[size]}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-600">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-stone-300 px-3 py-2.5 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200';

export function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="py-16 text-center text-stone-500">
      <p className="text-4xl">{icon}</p>
      <p className="mt-3 text-sm">{message}</p>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'amber' | 'red' | 'emerald';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-stone-100 text-stone-600',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
    emerald: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

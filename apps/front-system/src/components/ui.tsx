/** FRONT-system 共通の小さな UI 部品 */
import type { ReactNode } from 'react';

export function Spinner({ label = '読み込んでいます' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-stone-500">
      <div className="size-8 animate-spin rounded-full border-3 border-stone-300 border-t-amber-600" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-4 my-8 rounded-2xl bg-white p-6 text-center shadow-sm">
      <p className="text-stone-700">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-full bg-stone-800 px-6 py-2.5 text-sm font-medium text-white active:bg-stone-700"
        >
          もう一度試す
        </button>
      )}
    </div>
  );
}

/** 画面上部の見出し。席番号を常に表示して、どの席の画面か分かるようにする */
export function Header({
  title,
  tableNumber,
}: {
  title: string;
  tableNumber?: string | null;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight">{title}</h1>
        {tableNumber && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">
            {tableNumber} 番テーブル
          </span>
        )}
      </div>
    </header>
  );
}

/** 下部固定の主要ボタン */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  tone = 'amber',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'amber' | 'stone';
}) {
  const toneClass =
    tone === 'amber'
      ? 'bg-amber-600 active:bg-amber-700'
      : 'bg-stone-800 active:bg-stone-700';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-2xl px-5 py-4 text-base font-bold text-white shadow-lg transition disabled:bg-stone-300 disabled:shadow-none ${toneClass}`}
    >
      {children}
    </button>
  );
}

/** 操作完了を伝える一時表示 */
export function Toast({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-4">
      <div className="rounded-full bg-stone-900/90 px-5 py-3 text-sm font-medium text-white shadow-lg">
        {message}
      </div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 py-20 text-center text-sm text-stone-500">
      {message}
    </div>
  );
}

/**
 * 呼び出しシート (FR-06 / FR-07)
 *
 * 「食後の商品をお出しする」は、食後指定で未提供の商品がある場合にだけ表示する。
 * 押しても意味のないボタンを並べないため。
 */
import { useState } from 'react';
import type { CallType } from '@bridge/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  onCall: (type: CallType) => Promise<void>;
  /** 食後指定で未提供の商品があるか */
  hasPendingAfterItems: boolean;
}

export function CallSheet({ open, onClose, onCall, hasPendingAfterItems }: Props) {
  const [sending, setSending] = useState<CallType | null>(null);

  if (!open) return null;

  const handle = async (type: CallType) => {
    setSending(type);
    try {
      await onCall(type);
      onClose();
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/40"
      />

      <div className="safe-bottom relative mx-auto w-full max-w-lg rounded-t-3xl bg-white p-5 pb-8 shadow-2xl">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-stone-300" />
        <h2 className="mb-1 text-center text-lg font-bold">店員を呼ぶ</h2>
        <p className="mb-5 text-center text-sm text-stone-500">
          ご用件をお選びください
        </p>

        <div className="space-y-3">
          <button
            type="button"
            disabled={sending !== null}
            onClick={() => handle('bell')}
            className="flex w-full items-center gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-left active:bg-stone-100 disabled:opacity-50"
          >
            <span className="flex-1">
              <span className="block font-bold">店員を呼ぶ</span>
              <span className="block text-sm text-stone-500">
                ご相談・ご用件があるとき
              </span>
            </span>
            {sending === 'bell' && <span className="text-sm text-stone-400">送信中</span>}
          </button>

          {hasPendingAfterItems && (
            <button
              type="button"
              disabled={sending !== null}
              onClick={() => handle('serve_after')}
              className="flex w-full items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left active:bg-amber-100 disabled:opacity-50"
            >
              <span className="flex-1">
                <span className="block font-bold">食後の商品をお願いする</span>
                <span className="block text-sm text-stone-600">
                  お預かりしているデザート・ドリンクをお出しします
                </span>
              </span>
              {sending === 'serve_after' && (
                <span className="text-sm text-stone-400">送信中</span>
              )}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-2xl bg-stone-100 py-3.5 font-medium text-stone-600 active:bg-stone-200"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

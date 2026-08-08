/**
 * お会計 (FR-08 / FR-09)
 *
 * 会計ボタンを押すと店員に通知が飛び、同時にこの端末へ
 * 未会計の全注文をまとめたデジタル伝票を表示する。
 */
import { useState } from 'react';
import { formatTime, formatYen } from '@bridge/shared';
import { useAppContext } from '../App';
import { callStaff } from '../lib/api';
import { EmptyState, Header, PrimaryButton, Spinner } from '../components/ui';

export default function Bill() {
  const { qrToken, tableNumber, bill, reloadBill, notify } = useAppContext();
  const [requesting, setRequesting] = useState(false);

  const requested = bill?.session?.status === 'checkout_requested';

  const handleCheckout = async () => {
    setRequesting(true);
    try {
      await callStaff(qrToken, 'checkout');
      notify('お会計をお伝えしました。少々お待ちください');
      await reloadBill();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'お伝えできませんでした');
    } finally {
      setRequesting(false);
    }
  };

  if (!bill) {
    return (
      <>
        <Header title="お会計" tableNumber={tableNumber} />
        <Spinner />
      </>
    );
  }

  if (bill.lines.length === 0) {
    return (
      <>
        <Header title="お会計" tableNumber={tableNumber} />
        <EmptyState message="お会計の対象となるご注文がありません" />
      </>
    );
  }

  return (
    <>
      <Header title="お会計" tableNumber={tableNumber} />

      <div className="px-4 py-4">
        {/* デジタル伝票 */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="border-b border-dashed border-stone-300 pb-4 text-center">
            <p className="text-sm text-stone-500">ご利用明細</p>
            <p className="mt-1 text-lg font-bold">{tableNumber} 番テーブル</p>
            {bill.session && (
              <p className="mt-0.5 text-xs text-stone-400">
                {formatTime(bill.session.opened_at)} ご来店
              </p>
            )}
          </div>

          <ul className="divide-y divide-stone-100 py-2">
            {bill.lines.map((line) => (
              // 商品名は省略せず折り返す。伝票は金額の根拠なので、
              // 何を注文したのかが読めなくなってはいけない。
              <li key={line.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="leading-snug">{line.item_name}</p>
                  <p className="text-sm tabular-nums text-stone-500">
                    {formatYen(line.unit_price)} × {line.quantity}
                  </p>
                </div>
                <span className="shrink-0 pt-0.5 font-medium tabular-nums">
                  {formatYen(line.subtotal)}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t-2 border-stone-800 pt-4">
            <span className="text-lg font-bold">合計</span>
            <span className="text-2xl font-bold tabular-nums">
              {formatYen(bill.total)}
            </span>
          </div>

          <p className="mt-4 text-center text-xs leading-relaxed text-stone-400">
            この画面をレジでご提示ください
          </p>
        </div>

        {/* 会計依頼 */}
        <div className="mt-5">
          {requested ? (
            <div className="rounded-2xl bg-emerald-50 p-5 text-center ring-1 ring-emerald-200">
              <p className="font-bold text-emerald-900">
                お会計をお伝えしました
              </p>
              <p className="mt-1 text-sm text-emerald-800">
                係の者がうかがいます。少々お待ちください
              </p>
            </div>
          ) : (
            <PrimaryButton
              onClick={() => void handleCheckout()}
              disabled={requesting}
              tone="stone"
            >
              {requesting ? '送信しています…' : 'お会計をお願いする'}
            </PrimaryButton>
          )}
        </div>
      </div>
    </>
  );
}

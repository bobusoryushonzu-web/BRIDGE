/**
 * 注文内容と提供状況の確認 (FR-05)
 *
 * 食後にお預かりしている商品を分けて表示し、
 * 「まだ出てきていないのか、あとで出てくるのか」が一目で分かるようにする。
 */
import { useState } from 'react';
import type { BillLine } from '@bridge/shared';
import { formatTime, formatYen } from '@bridge/shared';
import { useAppContext } from '../App';
import { EmptyState, Header, Spinner } from '../components/ui';

function LineRow({ line }: { line: BillLine }) {
  const served = line.status === 'served';
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-full ${
          served ? 'bg-emerald-100' : 'bg-stone-100'
        }`}
        aria-hidden
      >
        <span
          className={`size-2.5 rounded-full ${served ? 'bg-emerald-600' : 'bg-stone-300'}`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {line.item_name}
          {line.quantity > 1 && (
            <span className="ml-1.5 text-stone-500">×{line.quantity}</span>
          )}
        </p>
        <p className="text-xs text-stone-400">
          {formatTime(line.ordered_at)} 注文・{served ? '提供済み' : '準備中'}
        </p>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-stone-600">
        {formatYen(line.subtotal)}
      </span>
    </li>
  );
}

export default function MyOrders() {
  const { tableNumber, bill, reloadBill } = useAppContext();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await reloadBill();
    setRefreshing(false);
  };

  if (!bill) {
    return (
      <>
        <Header title="ご注文内容" tableNumber={tableNumber} />
        <Spinner />
      </>
    );
  }

  const duringLines = bill.lines.filter((l) => l.serve_timing === 'during');
  const afterLines = bill.lines.filter((l) => l.serve_timing === 'after');

  return (
    <>
      <Header title="ご注文内容" tableNumber={tableNumber} />

      <div className="px-4 py-4">
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="w-full rounded-xl bg-white py-2.5 text-sm font-medium text-stone-600 shadow-sm active:bg-stone-50 disabled:opacity-60"
        >
          {refreshing ? '更新しています…' : '最新の状況に更新する'}
        </button>
      </div>

      {bill.lines.length === 0 ? (
        <EmptyState
          message="まだご注文はありません。メニューからお選びください"
        />
      ) : (
        <div className="space-y-4 px-4 pb-6">
          {duringLines.length > 0 && (
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="mb-1 font-bold">お食事</h2>
              <ul className="divide-y divide-stone-100">
                {duringLines.map((line) => (
                  <LineRow key={line.id} line={line} />
                ))}
              </ul>
            </section>
          )}

          {afterLines.length > 0 && (
            <section className="rounded-2xl bg-amber-50 p-4 shadow-sm ring-1 ring-amber-200">
              <h2 className="font-bold text-amber-900">食後にお出しする商品</h2>
              <p className="mb-1 text-xs text-amber-800">
                お食事が済みましたら、下の「呼ぶ」からお知らせください
              </p>
              <ul className="divide-y divide-amber-100">
                {afterLines.map((line) => (
                  <LineRow key={line.id} line={line} />
                ))}
              </ul>
            </section>
          )}

          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-4 shadow-sm">
            <span className="font-bold">現在の合計</span>
            <span className="text-lg font-bold tabular-nums">
              {formatYen(bill.total)}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

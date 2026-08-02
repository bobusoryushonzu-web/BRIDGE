/**
 * 注文照会・会計 (BK-05 / BK-12)
 *
 * 席ごとの伝票を確認し、レジでの精算後に会計を完了してセッションを閉じる。
 * 誤注文の明細をここから取り消すこともできる。
 */
import { useCallback, useEffect, useState } from 'react';
import type { SessionSummary } from '@bridge/shared';
import {
  SERVE_TIMING_LABEL,
  SESSION_STATUS_LABEL,
  formatTime,
  formatYen,
} from '@bridge/shared';
import {
  closeSession,
  deleteOrderItem,
  fetchSessionItems,
  fetchSessions,
  type BillItem,
} from '../lib/queries';
import { useRealtimeRefresh } from '../lib/realtime';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  PageTitle,
  Spinner,
} from '../components/ui';

export default function Orders() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [items, setItems] = useState<BillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchSessions(includeClosed);
      setSessions(next);
      setError(null);
      // 開いている伝票の金額も最新にする
      setSelected((current) =>
        current
          ? next.find((s) => s.session_id === current.session_id) ?? current
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [includeClosed]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh(['orders', 'order_items', 'sessions'], () => {
    void load();
  });

  const openBill = async (session: SessionSummary) => {
    setSelected(session);
    setItemsLoading(true);
    try {
      setItems(await fetchSessionItems(session.session_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '明細を読み込めませんでした');
    } finally {
      setItemsLoading(false);
    }
  };

  const onDeleteItem = async (item: BillItem) => {
    const label = item.quantity > 1 ? `${item.item_name}×${item.quantity}` : item.item_name;
    if (!window.confirm(`「${label}」を伝票から取り消します。よろしいですか？`)) return;
    try {
      await deleteOrderItem(item.id);
      if (selected) await openBill(selected);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '取り消せませんでした');
    }
  };

  const onCloseSession = async (session: SessionSummary) => {
    if (
      !window.confirm(
        `${session.table_number}番テーブルのお会計 ${formatYen(session.total_amount)} を完了します。\nレジでの精算は済んでいますか？`,
      )
    ) {
      return;
    }
    try {
      await closeSession(session.session_id);
      setSelected(null);
      setItems([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '会計を完了できませんでした');
    }
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageTitle
        title="注文照会・会計"
        description="席ごとの伝票を確認し、精算後に会計を完了します"
        action={
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(e) => setIncludeClosed(e.target.checked)}
              className="size-4 rounded"
            />
            会計済みも表示
          </label>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* 席の一覧 */}
        <section>
          {sessions.length === 0 ? (
            <EmptyState icon="🪑" message="ご利用中の席はありません" />
          ) : (
            <ul className="space-y-2">
              {sessions.map((session) => {
                const active = selected?.session_id === session.session_id;
                return (
                  <li key={session.session_id}>
                    <button
                      type="button"
                      onClick={() => void openBill(session)}
                      className={`w-full rounded-2xl bg-white p-4 text-left shadow-sm transition hover:bg-stone-50 ${
                        active ? 'ring-2 ring-stone-800' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-bold">
                            <span className="text-xl tabular-nums">
                              {session.table_number}
                            </span>
                            <span className="ml-1 text-sm font-medium text-stone-500">
                              番テーブル
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs text-stone-400">
                            {formatTime(session.opened_at)} から・
                            {session.item_count}点
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold tabular-nums">
                            {formatYen(session.total_amount)}
                          </p>
                          <div className="mt-1 flex justify-end gap-1">
                            {session.status === 'checkout_requested' && (
                              <Badge tone="red">会計依頼</Badge>
                            )}
                            {session.status === 'closed' && (
                              <Badge tone="neutral">会計済み</Badge>
                            )}
                            {session.pending_count > 0 && (
                              <Badge tone="amber">
                                未提供{session.pending_count}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 伝票の明細 */}
        <section>
          {!selected ? (
            <Card className="text-center text-sm text-stone-500">
              左の一覧から席を選ぶと伝票が表示されます
            </Card>
          ) : (
            <Card>
              <div className="mb-4 flex items-start justify-between gap-3 border-b border-stone-200 pb-4">
                <div>
                  <p className="text-xl font-bold">
                    {selected.table_number} 番テーブル
                  </p>
                  <p className="mt-0.5 text-sm text-stone-500">
                    {SESSION_STATUS_LABEL[selected.status]}・
                    {formatTime(selected.opened_at)} から
                  </p>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {formatYen(selected.total_amount)}
                </p>
              </div>

              {itemsLoading ? (
                <Spinner label="明細を読み込んでいます" />
              ) : items.length === 0 ? (
                <p className="py-8 text-center text-sm text-stone-500">
                  明細がありません
                </p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {item.item_name}
                          {item.quantity > 1 && (
                            <span className="ml-1.5 text-stone-500">
                              ×{item.quantity}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-stone-400">
                          {formatTime(item.created_at)}・
                          {SERVE_TIMING_LABEL[item.serve_timing]}・
                          {item.status === 'served' ? '提供済み' : '未提供'}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums">
                        {formatYen(item.unit_price * item.quantity)}
                      </span>
                      {selected.status !== 'closed' && (
                        <button
                          type="button"
                          onClick={() => void onDeleteItem(item)}
                          aria-label={`${item.item_name}を取り消す`}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50"
                        >
                          取消
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {selected.status !== 'closed' && (
                <div className="mt-5 border-t border-stone-200 pt-5">
                  <Button
                    tone="primary"
                    onClick={() => void onCloseSession(selected)}
                  >
                    会計を完了してテーブルを空ける
                  </Button>
                  <p className="mt-2 text-xs text-stone-500">
                    レジでの精算後に押してください。押すとこの席は次のお客様を受け入れられます。
                  </p>
                </div>
              )}
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

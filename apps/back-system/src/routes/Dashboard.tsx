/**
 * ダッシュボード (BK-08 / BK-09 / BK-10 / BK-11)
 *
 * 未対応の呼び出しと新着注文をリアルタイムに表示する。
 * 呼び出しは対応済みにするまで消えないため、取りこぼしが起きない。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CALL_TYPE_LABEL,
  CALL_TYPE_TONE,
  SERVE_TIMING_LABEL,
  formatElapsed,
  formatTime,
  formatYen,
} from '@bridge/shared';
import { useAuth } from '../lib/auth';
import {
  fetchOpenCalls,
  fetchRecentOrders,
  fetchSessions,
  handleCall,
  type OpenCall,
  type RecentOrder,
} from '../lib/queries';
import { playAlert, useRealtimeRefresh } from '../lib/realtime';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  PageTitle,
  Spinner,
} from '../components/ui';

/** 何分以上待たせている呼び出しを警告扱いにするか */
const URGENT_MINUTES = 3;

export default function Dashboard() {
  const { staff } = useAuth();
  const [calls, setCalls] = useState<OpenCall[]>([]);
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 経過時間の表示を更新するための現在時刻
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  // 新しい呼び出しが増えたときだけ音を鳴らす
  const previousCallIds = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [nextCalls, nextOrders, sessions] = await Promise.all([
        fetchOpenCalls(),
        fetchRecentOrders(15),
        fetchSessions(false),
      ]);

      const isFirstLoad = previousCallIds.current.size === 0 && calls.length === 0;
      const hasNew = nextCalls.some((c) => !previousCallIds.current.has(c.id));
      if (hasNew && !isFirstLoad) playAlert();
      previousCallIds.current = new Set(nextCalls.map((c) => c.id));

      setCalls(nextCalls);
      setOrders(nextOrders);
      setTotals(new Map(sessions.map((s) => [s.session_id, s.total_amount])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
    // calls は初回判定にのみ使うため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh(['staff_calls', 'orders', 'order_items', 'sessions'], () => {
    void load();
  });

  const onHandle = async (callId: string) => {
    if (!staff) return;
    try {
      await handleCall(callId, staff.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '対応済みにできませんでした');
    }
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageTitle
        title="ダッシュボード"
        description="お客様からの呼び出しと新しいご注文がここに届きます"
      />

      {error && <ErrorBanner message={error} />}

      {/* 未対応の呼び出し */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          未対応の呼び出し
          {calls.length > 0 && (
            <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-sm text-white tabular-nums">
              {calls.length}
            </span>
          )}
        </h2>

        {calls.length === 0 ? (
          <Card className="text-center text-sm text-stone-500">
            未対応の呼び出しはありません
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {calls.map((call) => {
              const minutes = Math.floor(
                (now - new Date(call.created_at).getTime()) / 60000,
              );
              const urgent = minutes >= URGENT_MINUTES;

              return (
                <li
                  key={call.id}
                  className={`rounded-2xl bg-white p-4 shadow-sm ring-2 ${
                    urgent ? 'alert-pulse ring-red-400' : 'ring-stone-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-2xl font-black tabular-nums">
                        {call.table_number}
                        <span className="ml-1 text-sm font-medium text-stone-500">
                          番テーブル
                        </span>
                      </p>
                      <p className="mt-1">
                        <Badge tone={CALL_TYPE_TONE[call.type]}>
                          {CALL_TYPE_LABEL[call.type]}
                        </Badge>
                      </p>
                    </div>
                    <Badge tone={urgent ? 'red' : 'neutral'}>
                      {formatElapsed(call.created_at, now)}
                    </Badge>
                  </div>

                  {/* 会計依頼には合計金額を添える (BK-11) */}
                  {call.type === 'checkout' && (
                    <p className="mt-2 text-lg font-bold tabular-nums text-emerald-700">
                      {formatYen(totals.get(call.session_id) ?? 0)}
                    </p>
                  )}

                  {/* 食後提供の合図には対象商品を添える (BK-10) */}
                  {call.type === 'serve_after' && call.pending_after_items.length > 0 && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {call.pending_after_items.join('、')}
                    </p>
                  )}

                  <div className="mt-4">
                    <Button tone="success" onClick={() => void onHandle(call.id)}>
                      対応済みにする
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 新着注文 */}
      <section>
        <h2 className="mb-3 text-lg font-bold">新着のご注文</h2>

        {orders.length === 0 ? (
          <EmptyState message="まだご注文はありません" />
        ) : (
          <ul className="space-y-3">
            {orders.map((order) => {
              const allServed = order.items.every((i) => i.status === 'served');
              return (
                <li key={order.id}>
                  <Card>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="font-bold">
                        <span className="text-xl tabular-nums">
                          {order.table_number}
                        </span>
                        <span className="ml-1 text-sm font-medium text-stone-500">
                          番テーブル
                        </span>
                      </p>
                      <div className="flex items-center gap-2">
                        {allServed ? (
                          <Badge tone="emerald">提供済み</Badge>
                        ) : (
                          <Badge tone="amber">未提供あり</Badge>
                        )}
                        <span className="text-sm text-stone-400 tabular-nums">
                          {formatTime(order.created_at)}
                        </span>
                      </div>
                    </div>

                    <ul className="flex flex-wrap gap-2">
                      {order.items.map((item) => (
                        <li
                          key={item.id}
                          className={`rounded-lg px-3 py-1.5 text-sm ${
                            item.status === 'served'
                              ? 'bg-stone-100 text-stone-400 line-through'
                              : 'bg-stone-800 text-white'
                          }`}
                        >
                          {item.item_name}
                          {item.quantity > 1 && ` ×${item.quantity}`}
                          {item.serve_timing === 'after' && (
                            <span className="ml-1.5 text-xs opacity-80">
                              ({SERVE_TIMING_LABEL.after})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

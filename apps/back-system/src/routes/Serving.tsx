/**
 * 提供状況 (BK-06 / BK-07)
 *
 * 「食中・未提供」と「食後・待機中」を分けて表示する。
 * 食後の商品は意図的に保留しているものなので、同じ一覧に混ぜると
 * 本当に出し遅れている食中の商品が埋もれてしまうため。
 */
import { useCallback, useEffect, useState } from 'react';
import { formatElapsed } from '@bridge/shared';
import {
  fetchPendingItems,
  markServed,
  type PendingItem,
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

/** 何分以上出せていない食中の商品を警告扱いにするか */
const DELAY_MINUTES = 15;

interface GroupedItems {
  tableNumber: string;
  items: PendingItem[];
}

/** 席ごとにまとめる。店員は席単位で動くため */
function groupByTable(items: PendingItem[]): GroupedItems[] {
  const map = new Map<string, PendingItem[]>();
  for (const item of items) {
    const list = map.get(item.table_number) ?? [];
    list.push(item);
    map.set(item.table_number, list);
  }
  return [...map.entries()]
    .map(([tableNumber, list]) => ({ tableNumber, items: list }))
    .sort((a, b) =>
      a.tableNumber.localeCompare(b.tableNumber, 'ja', { numeric: true }),
    );
}

function ItemButton({
  item,
  now,
  onServe,
  warnAfterMinutes,
}: {
  item: PendingItem;
  now: number;
  onServe: (id: string) => void;
  warnAfterMinutes?: number;
}) {
  const minutes = Math.floor((now - new Date(item.created_at).getTime()) / 60000);
  const delayed =
    warnAfterMinutes !== undefined && minutes >= warnAfterMinutes;

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {item.item_name}
          {item.quantity > 1 && (
            <span className="ml-1.5 font-bold text-stone-600">×{item.quantity}</span>
          )}
        </p>
        <p className={`text-xs ${delayed ? 'font-bold text-red-600' : 'text-stone-400'}`}>
          {formatElapsed(item.created_at, now)}に注文
        </p>
      </div>
      {delayed && <Badge tone="red">お待たせ中</Badge>}
      <Button size="sm" tone="success" onClick={() => onServe(item.id)}>
        提供済み
      </Button>
    </li>
  );
}

export default function Serving() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    try {
      setItems(await fetchPendingItems());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh(['order_items', 'orders', 'sessions'], () => {
    void load();
  });

  const onServe = async (id: string) => {
    // 押した瞬間に消えるようにして、二重提供を防ぐ
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await markServed(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
      await load();
    }
  };

  if (loading) return <Spinner />;

  const during = groupByTable(items.filter((i) => i.serve_timing === 'during'));
  const after = groupByTable(items.filter((i) => i.serve_timing === 'after'));

  return (
    <>
      <PageTitle
        title="提供状況"
        description="まだお出ししていない商品の一覧です"
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 食中・未提供 = 今すぐ出すもの */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <span aria-hidden>🍳</span>
            今お出しするもの
            {during.length > 0 && (
              <span className="rounded-full bg-stone-800 px-2.5 py-0.5 text-sm text-white tabular-nums">
                {during.reduce((sum, g) => sum + g.items.length, 0)}
              </span>
            )}
          </h2>

          {during.length === 0 ? (
            <Card className="text-center text-sm text-stone-500">
              未提供の商品はありません
            </Card>
          ) : (
            <div className="space-y-3">
              {during.map((group) => (
                <Card key={group.tableNumber}>
                  <p className="mb-1 font-bold">
                    <span className="text-xl tabular-nums">{group.tableNumber}</span>
                    <span className="ml-1 text-sm font-medium text-stone-500">
                      番テーブル
                    </span>
                  </p>
                  <ul className="divide-y divide-stone-100">
                    {group.items.map((item) => (
                      <ItemButton
                        key={item.id}
                        item={item}
                        now={now}
                        onServe={(id) => void onServe(id)}
                        warnAfterMinutes={DELAY_MINUTES}
                      />
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* 食後・待機中 = 客の合図を待っているもの */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <span aria-hidden>🍰</span>
            食後にお出しするもの
          </h2>
          <p className="mb-3 text-sm text-stone-500">
            お客様から合図があるまでお預かりしている商品です。遅延ではありません。
          </p>

          {after.length === 0 ? (
            <Card className="text-center text-sm text-stone-500">
              お預かり中の商品はありません
            </Card>
          ) : (
            <div className="space-y-3">
              {after.map((group) => (
                <Card key={group.tableNumber} className="bg-amber-50">
                  <p className="mb-1 font-bold text-amber-900">
                    <span className="text-xl tabular-nums">{group.tableNumber}</span>
                    <span className="ml-1 text-sm font-medium">番テーブル</span>
                  </p>
                  <ul className="divide-y divide-amber-100">
                    {group.items.map((item) => (
                      <ItemButton
                        key={item.id}
                        item={item}
                        now={now}
                        onServe={(id) => void onServe(id)}
                      />
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>

      {items.length === 0 && (
        <EmptyState icon="✅" message="すべての商品をお出ししています" />
      )}
    </>
  );
}

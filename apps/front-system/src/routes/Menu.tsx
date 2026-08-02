/**
 * メニュー・注文画面 (FR-02 / FR-03 / FR-04)
 */
import { useEffect, useMemo, useState } from 'react';
import type { Category, MenuItem, ServeTiming } from '@bridge/shared';
import { SERVE_TIMING_LABEL, formatYen } from '@bridge/shared';
import { useAppContext } from '../App';
import { fetchMenu, placeOrder } from '../lib/api';
import { useCart } from '../lib/cart';
import { ErrorView, Header, PrimaryButton, Spinner } from '../components/ui';

export default function Menu() {
  const { qrToken, tableNumber, reloadBill, notify } = useAppContext();
  const cart = useCart();

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 商品ごとに選択中の提供タイミング。既定は食中 */
  const [timings, setTimings] = useState<Record<string, ServeTiming>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const menu = await fetchMenu();
      setCategories(menu.categories);
      setItems(menu.items);
      setActiveCategoryId((current) => current ?? menu.categories[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'メニューを読み込めませんでした');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // 初回のみ読み込む。品切れ状態は注文確定時にサーバー側で再確認される。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCategory = useMemo(
    () => categories.find((c) => c.id === activeCategoryId) ?? null,
    [categories, activeCategoryId],
  );

  const visibleItems = useMemo(
    () => items.filter((item) => item.category_id === activeCategoryId),
    [items, activeCategoryId],
  );

  const timingOf = (itemId: string): ServeTiming => timings[itemId] ?? 'during';

  const handleSubmit = async () => {
    if (cart.lines.length === 0) return;
    setSubmitting(true);
    try {
      await placeOrder(qrToken, cart.toOrderItems());
      cart.clear();
      setCartOpen(false);
      notify('ご注文を承りました');
      await reloadBill();
    } catch (e) {
      notify(e instanceof Error ? e.message : '注文できませんでした');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner label="メニューを読み込んでいます" />;
  if (error) return <ErrorView message={error} onRetry={() => void load()} />;

  return (
    <>
      <Header title="メニュー" tableNumber={tableNumber} />

      {/* カテゴリ切り替え */}
      <div className="sticky top-[57px] z-10 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="flex gap-2 overflow-x-auto px-4 py-3">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategoryId(category.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${
                category.id === activeCategoryId
                  ? 'bg-amber-600 text-white'
                  : 'bg-stone-100 text-stone-600'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {activeCategory?.allows_timing_choice && (
        <p className="mx-4 mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          お出しするタイミングを「食中」「食後」からお選びいただけます。
        </p>
      )}

      <ul className="divide-y divide-stone-200 px-4">
        {visibleItems.map((item) => {
          const timing = timingOf(item.id);
          const quantity = cart.quantityOf(item.id, timing);
          const soldOut = !item.is_available;

          return (
            <li key={item.id} className="py-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-bold ${soldOut ? 'text-stone-400' : 'text-stone-900'}`}
                  >
                    {item.name}
                    {soldOut && (
                      <span className="ml-2 rounded bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-600">
                        品切れ
                      </span>
                    )}
                  </p>
                  {item.description && (
                    <p className="mt-1 text-sm leading-relaxed text-stone-500">
                      {item.description}
                    </p>
                  )}
                  <p className="mt-1.5 font-bold text-amber-800">
                    {formatYen(item.price)}
                  </p>
                </div>

                {/* 数量の増減 */}
                <div className="flex shrink-0 items-center gap-2 pt-1">
                  {quantity > 0 && (
                    <>
                      <button
                        type="button"
                        aria-label={`${item.name}を1つ減らす`}
                        onClick={() => cart.remove(item.id, timing)}
                        className="size-9 rounded-full border border-stone-300 text-lg font-bold text-stone-600 active:bg-stone-100"
                      >
                        −
                      </button>
                      <span className="w-5 text-center font-bold tabular-nums">
                        {quantity}
                      </span>
                    </>
                  )}
                  <button
                    type="button"
                    aria-label={`${item.name}を1つ追加`}
                    disabled={soldOut}
                    onClick={() =>
                      cart.add({
                        menuItemId: item.id,
                        name: item.name,
                        price: item.price,
                        serveTiming: timing,
                      })
                    }
                    className="size-9 rounded-full bg-amber-600 text-lg font-bold text-white active:bg-amber-700 disabled:bg-stone-200 disabled:text-stone-400"
                  >
                    ＋
                  </button>
                </div>
              </div>

              {/* 提供タイミングの選択 (FR-03) */}
              {activeCategory?.allows_timing_choice && !soldOut && (
                <div className="mt-3 flex gap-2">
                  {(['during', 'after'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        setTimings((prev) => ({ ...prev, [item.id]: option }))
                      }
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium transition ${
                        timing === option
                          ? 'border-amber-600 bg-amber-50 text-amber-800'
                          : 'border-stone-200 bg-white text-stone-500'
                      }`}
                    >
                      {SERVE_TIMING_LABEL[option]}に
                      {cart.quantityOf(item.id, option) > 0 && (
                        <span className="ml-1 text-xs">
                          ({cart.quantityOf(item.id, option)})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {visibleItems.length === 0 && (
        <p className="py-16 text-center text-sm text-stone-400">
          このカテゴリの商品はまだありません
        </p>
      )}

      {/* カートバー */}
      {cart.totalQuantity > 0 && !cartOpen && (
        <div className="safe-bottom fixed inset-x-0 bottom-16 z-30 mx-auto max-w-lg px-4 pb-2">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="flex w-full items-center justify-between rounded-2xl bg-stone-900 px-5 py-4 text-white shadow-xl active:bg-stone-800"
          >
            <span className="flex items-center gap-2 font-bold">
              <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-sm tabular-nums">
                {cart.totalQuantity}
              </span>
              点を注文する
            </span>
            <span className="font-bold tabular-nums">
              {formatYen(cart.totalAmount)}
            </span>
          </button>
        </div>
      )}

      {/* カートの確認 */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex items-end" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => setCartOpen(false)}
            className="absolute inset-0 bg-stone-900/40"
          />
          <div className="safe-bottom relative mx-auto max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-stone-300" />
            <h2 className="mb-4 text-center text-lg font-bold">ご注文内容の確認</h2>

            <ul className="divide-y divide-stone-100">
              {cart.lines.map((line) => (
                <li
                  key={`${line.menuItemId}:${line.serveTiming}`}
                  className="flex items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{line.name}</p>
                    <p className="text-sm text-stone-500">
                      {SERVE_TIMING_LABEL[line.serveTiming]}に・
                      {formatYen(line.price)}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${line.name}を1つ減らす`}
                    onClick={() => cart.remove(line.menuItemId, line.serveTiming)}
                    className="size-8 rounded-full border border-stone-300 font-bold text-stone-600 active:bg-stone-100"
                  >
                    −
                  </button>
                  <span className="w-5 text-center font-bold tabular-nums">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`${line.name}を1つ追加`}
                    onClick={() =>
                      cart.add({
                        menuItemId: line.menuItemId,
                        name: line.name,
                        price: line.price,
                        serveTiming: line.serveTiming,
                      })
                    }
                    className="size-8 rounded-full bg-amber-600 font-bold text-white active:bg-amber-700"
                  >
                    ＋
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between border-t border-stone-200 pt-4 text-lg font-bold">
              <span>合計</span>
              <span className="tabular-nums">{formatYen(cart.totalAmount)}</span>
            </div>

            <div className="mt-5">
              <PrimaryButton onClick={() => void handleSubmit()} disabled={submitting}>
                {submitting ? '送信しています…' : 'この内容で注文する'}
              </PrimaryButton>
            </div>
            <button
              type="button"
              onClick={() => setCartOpen(false)}
              className="mt-3 w-full py-2 text-sm text-stone-500"
            >
              追加で選ぶ
            </button>
          </div>
        </div>
      )}
    </>
  );
}

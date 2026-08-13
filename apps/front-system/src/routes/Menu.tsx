/**
 * メニュー・注文画面 (FR-02 / FR-03 / FR-04)
 */
import { useEffect, useMemo, useState } from 'react';
import type { Category, MenuItem, MenuItemOption, ServeTiming } from '@bridge/shared';
import { SERVE_TIMING_LABEL, formatYen } from '@bridge/shared';
import { useAppContext } from '../App';
import { fetchMenu, placeOrder } from '../lib/api';
import { type CartOption, lineUnitPrice, useCart } from '../lib/cart';
import { ErrorView, Header, PrimaryButton, Spinner } from '../components/ui';

export default function Menu() {
  const { qrToken, tableNumber, reloadBill, notify } = useAppContext();
  const cart = useCart();

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [options, setOptions] = useState<MenuItemOption[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 商品ごとに選択中の提供タイミング。既定は食中 */
  const [timings, setTimings] = useState<Record<string, ServeTiming>>({});
  /** 商品ごとに選択中のオプションID */
  const [selectedOptionIds, setSelectedOptionIds] = useState<Record<string, string[]>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const menu = await fetchMenu();
      setCategories(menu.categories);
      setItems(menu.items);
      setOptions(menu.options);
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

  const optionsByItem = useMemo(() => {
    const map = new Map<string, MenuItemOption[]>();
    for (const option of options) {
      const list = map.get(option.menu_item_id) ?? [];
      list.push(option);
      map.set(option.menu_item_id, list);
    }
    return map;
  }, [options]);

  const visibleItems = useMemo(
    () => items.filter((item) => item.category_id === activeCategoryId),
    [items, activeCategoryId],
  );

  // このカテゴリに、提供タイミングを選べる商品が1つでもあれば案内文を出す
  const hasTimingChoiceItem = useMemo(
    () => visibleItems.some((item) => item.allows_timing_choice),
    [visibleItems],
  );

  const timingOf = (itemId: string): ServeTiming => timings[itemId] ?? 'during';

  /** 商品ごとに、現在選択中のオプションを CartOption の形で返す */
  const selectedOptionsOf = (itemId: string): CartOption[] => {
    const itemOptions = optionsByItem.get(itemId) ?? [];
    const selectedIds = selectedOptionIds[itemId] ?? [];
    return itemOptions
      .filter((o) => selectedIds.includes(o.id))
      .map((o) => ({ id: o.id, name: o.name, extraPrice: o.extra_price }));
  };

  const toggleOption = (itemId: string, optionId: string) => {
    setSelectedOptionIds((prev) => {
      const current = prev[itemId] ?? [];
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      return { ...prev, [itemId]: next };
    });
  };

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

      {hasTimingChoiceItem && (
        <p className="mx-4 mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          一部の商品は、お出しするタイミングを「食中」「食後」からお選びいただけます。
        </p>
      )}

      <ul className="divide-y divide-stone-200 px-4">
        {visibleItems.map((item) => {
          const timing = timingOf(item.id);
          const itemOptions = optionsByItem.get(item.id) ?? [];
          const chosenOptions = selectedOptionsOf(item.id);
          const quantity = cart.quantityOf(item.id, timing, chosenOptions);
          const soldOut = !item.is_available;
          const unitPrice = lineUnitPrice({ price: item.price, options: chosenOptions });

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
                    {formatYen(unitPrice)}
                    {chosenOptions.length > 0 && (
                      <span className="ml-1 text-xs font-medium text-stone-500">
                        (本体 {formatYen(item.price)})
                      </span>
                    )}
                  </p>
                </div>

                {/* 数量の増減 */}
                <div className="flex shrink-0 items-center gap-2 pt-1">
                  {quantity > 0 && (
                    <>
                      <button
                        type="button"
                        aria-label={`${item.name}を1つ減らす`}
                        onClick={() => cart.remove(item.id, timing, chosenOptions)}
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
                        options: chosenOptions,
                      })
                    }
                    className="size-9 rounded-full bg-amber-600 text-lg font-bold text-white active:bg-amber-700 disabled:bg-stone-200 disabled:text-stone-400"
                  >
                    ＋
                  </button>
                </div>
              </div>

              {/* 提供タイミングの選択 (FR-03) */}
              {item.allows_timing_choice && !soldOut && (
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
                      {cart.quantityOf(item.id, option, chosenOptions) > 0 && (
                        <span className="ml-1 text-xs">
                          ({cart.quantityOf(item.id, option, chosenOptions)})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* オプションの選択 */}
              {itemOptions.length > 0 && !soldOut && (
                <div className="mt-3 space-y-1.5">
                  {itemOptions.map((option) => {
                    const checked = (selectedOptionIds[item.id] ?? []).includes(option.id);
                    return (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOption(item.id, option.id)}
                          className="size-4"
                        />
                        <span className="flex-1">{option.name}</span>
                        <span className="text-stone-500">
                          +{formatYen(option.extra_price)}
                        </span>
                      </label>
                    );
                  })}
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
                  key={`${line.menuItemId}:${line.serveTiming}:${line.options.map((o) => o.id).join(',')}`}
                  className="flex items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{line.name}</p>
                    <p className="text-sm text-stone-500">
                      {SERVE_TIMING_LABEL[line.serveTiming]}に・
                      {formatYen(lineUnitPrice(line))}
                    </p>
                    {line.options.length > 0 && (
                      <p className="text-xs text-stone-400">
                        {line.options
                          .map((o) => `${o.name}(+${formatYen(o.extraPrice)})`)
                          .join('、')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`${line.name}を1つ減らす`}
                    onClick={() =>
                      cart.remove(line.menuItemId, line.serveTiming, line.options)
                    }
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
                        options: line.options,
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

/**
 * 商品管理 (BK-01 / BK-02 / BK-03 / BK-04)
 *
 * 削除は論理削除。物理削除すると過去の伝票が参照先を失うため。
 * 一時的に出せないだけなら「品切れ」を使う。
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Category, MenuItem, MenuItemOption } from '@bridge/shared';
import { formatYen } from '@bridge/shared';
import {
  createCategory,
  createMenuItem,
  createMenuItemOption,
  deleteMenuItem,
  deleteMenuItemOption,
  fetchCategories,
  fetchMenuItemOptions,
  fetchMenuItems,
  updateMenuItem,
  updateMenuItemOption,
} from '../lib/queries';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  PageTitle,
  Spinner,
  inputClass,
} from '../components/ui';

/** 追加フォームで入力中のオプション1行分 */
interface OptionDraft {
  name: string;
  price: string;
}

export default function MenuAdmin() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [options, setOptions] = useState<MenuItemOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 商品追加フォーム
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  /** 提供パターン。即提供のみか、食後に回すことも選べるか */
  const [allowsTimingChoice, setAllowsTimingChoice] = useState(false);
  /** オプションあり/なし。ありの場合のみ下の入力欄を出す */
  const [hasOptions, setHasOptions] = useState(false);
  const [optionDrafts, setOptionDrafts] = useState<OptionDraft[]>([
    { name: '', price: '' },
  ]);
  /** セット割引(ドリンクカテゴリの商品のみ設定可能) */
  const [comboDiscountName, setComboDiscountName] = useState('');
  const [comboDiscountAmount, setComboDiscountAmount] = useState('');

  // カテゴリ追加フォーム
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryName, setCategoryName] = useState('');

  // 商品一覧側の、オプション管理を開いている商品
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [newOptionName, setNewOptionName] = useState('');
  const [newOptionPrice, setNewOptionPrice] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextCategories, nextItems, nextOptions] = await Promise.all([
        fetchCategories(),
        fetchMenuItems(),
        fetchMenuItemOptions(),
      ]);
      setCategories(nextCategories);
      setItems(nextItems);
      setOptions(nextOptions);
      setCategoryId((current) => current || nextCategories[0]?.id || '');
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

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isDrinkCategory = selectedCategory?.is_drink ?? false;

  const handleAddItem = async (event: FormEvent) => {
    event.preventDefault();
    const priceValue = Number(price);
    if (!name.trim() || !categoryId) return;
    if (!Number.isInteger(priceValue) || priceValue < 0) {
      setError('価格は0以上の整数で入力してください');
      return;
    }

    // オプションありの場合、名前と価格の両方が埋まっている行だけを登録対象にする
    const validOptionDrafts = hasOptions
      ? optionDrafts.filter((d) => d.name.trim() !== '' && d.price.trim() !== '')
      : [];
    if (hasOptions) {
      for (const draft of validOptionDrafts) {
        const optionPrice = Number(draft.price);
        if (!Number.isInteger(optionPrice) || optionPrice < 0) {
          setError('オプションの追加料金は0以上の整数で入力してください');
          return;
        }
      }
    }

    // セット割引はドリンクカテゴリの商品にのみ設定できる。名前・金額とも
    // 入力されている場合だけ登録対象にする
    let comboDiscount: { name: string | null; amount: number } | null = null;
    if (isDrinkCategory && comboDiscountName.trim() !== '' && comboDiscountAmount.trim() !== '') {
      const discountValue = Number(comboDiscountAmount);
      if (!Number.isInteger(discountValue) || discountValue < 0) {
        setError('セット割引の金額は0以上の整数で入力してください');
        return;
      }
      comboDiscount = { name: comboDiscountName.trim(), amount: discountValue };
    }

    setSaving(true);
    try {
      const itemId = await createMenuItem({
        category_id: categoryId,
        name: name.trim(),
        price: priceValue,
        description: description.trim(),
        allows_timing_choice: allowsTimingChoice,
        combo_discount_name: comboDiscount?.name ?? null,
        combo_discount_amount: comboDiscount?.amount ?? 0,
      });

      for (let i = 0; i < validOptionDrafts.length; i++) {
        await createMenuItemOption({
          menu_item_id: itemId,
          name: validOptionDrafts[i].name.trim(),
          extra_price: Number(validOptionDrafts[i].price),
          sort_order: i + 1,
        });
      }

      setName('');
      setPrice('');
      setDescription('');
      setAllowsTimingChoice(false);
      setHasOptions(false);
      setOptionDrafts([{ name: '', price: '' }]);
      setComboDiscountName('');
      setComboDiscountAmount('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const updateOptionDraft = (index: number, patch: Partial<OptionDraft>) => {
    setOptionDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  };

  const addOptionDraftRow = () => {
    setOptionDrafts((prev) => [...prev, { name: '', price: '' }]);
  };

  const removeOptionDraftRow = (index: number) => {
    setOptionDrafts((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );
  };

  const handleAddCategory = async (event: FormEvent) => {
    event.preventDefault();
    if (!categoryName.trim()) return;
    setSaving(true);
    try {
      await createCategory({
        name: categoryName.trim(),
        sort_order: categories.length + 1,
      });
      setCategoryName('');
      setShowCategoryForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'カテゴリを追加できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailable = async (item: MenuItem) => {
    try {
      await updateMenuItem(item.id, { is_available: !item.is_available });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新できませんでした');
    }
  };

  /** 提供パターン(即提供/食後選択可能)の切り替え */
  const toggleTimingChoice = async (item: MenuItem) => {
    try {
      await updateMenuItem(item.id, {
        allows_timing_choice: !item.allows_timing_choice,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新できませんでした');
    }
  };

  const changePrice = async (item: MenuItem) => {
    const input = window.prompt(`「${item.name}」の新しい価格を入力してください`, String(item.price));
    if (input === null) return;
    const value = Number(input);
    if (!Number.isInteger(value) || value < 0) {
      setError('価格は0以上の整数で入力してください');
      return;
    }
    try {
      await updateMenuItem(item.id, { price: value });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新できませんでした');
    }
  };

  /** セット割引の設定・変更・解除(ドリンクカテゴリの商品のみ) */
  const changeComboDiscount = async (item: MenuItem) => {
    const nameInput = window.prompt(
      `「${item.name}」のセット割引の名称を入力してください(空欄にすると割引を解除します)`,
      item.combo_discount_name ?? 'セット割引',
    );
    if (nameInput === null) return;
    const trimmedName = nameInput.trim();

    if (trimmedName === '') {
      try {
        await updateMenuItem(item.id, { combo_discount_name: null, combo_discount_amount: 0 });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新できませんでした');
      }
      return;
    }

    const amountInput = window.prompt(
      `「${trimmedName}」の割引額(円)を入力してください`,
      String(item.combo_discount_amount || ''),
    );
    if (amountInput === null) return;
    const amountValue = Number(amountInput);
    if (!Number.isInteger(amountValue) || amountValue < 0) {
      setError('割引額は0以上の整数で入力してください');
      return;
    }

    try {
      await updateMenuItem(item.id, {
        combo_discount_name: trimmedName,
        combo_discount_amount: amountValue,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新できませんでした');
    }
  };

  const handleAddOptionToItem = async (itemId: string) => {
    const priceValue = Number(newOptionPrice);
    if (!newOptionName.trim()) return;
    if (!Number.isInteger(priceValue) || priceValue < 0) {
      setError('オプションの追加料金は0以上の整数で入力してください');
      return;
    }
    try {
      await createMenuItemOption({
        menu_item_id: itemId,
        name: newOptionName.trim(),
        extra_price: priceValue,
        sort_order: options.filter((o) => o.menu_item_id === itemId).length + 1,
      });
      setNewOptionName('');
      setNewOptionPrice('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'オプションを追加できませんでした');
    }
  };

  const handleChangeOptionPrice = async (option: MenuItemOption) => {
    const input = window.prompt(
      `「${option.name}」の新しい追加料金を入力してください`,
      String(option.extra_price),
    );
    if (input === null) return;
    const value = Number(input);
    if (!Number.isInteger(value) || value < 0) {
      setError('追加料金は0以上の整数で入力してください');
      return;
    }
    try {
      await updateMenuItemOption(option.id, { extra_price: value });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新できませんでした');
    }
  };

  const handleDeleteOption = async (option: MenuItemOption) => {
    if (!window.confirm(`「${option.name}」オプションを削除します。よろしいですか？`)) {
      return;
    }
    try {
      await deleteMenuItemOption(option.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除できませんでした');
    }
  };

  const handleDelete = async (item: MenuItem) => {
    if (
      !window.confirm(
        `「${item.name}」をメニューから削除します。\n\n過去の伝票は変更されません。一時的に出せないだけの場合は「品切れ」をお使いください。`,
      )
    ) {
      return;
    }
    try {
      await deleteMenuItem(item.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除できませんでした');
    }
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageTitle title="商品管理" description="メニューの追加・編集・削除を行います" />

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* 追加フォーム */}
        <div className="space-y-4">
          <Card>
            <h2 className="mb-4 font-bold">商品を追加</h2>
            <form onSubmit={handleAddItem} className="space-y-3">
              <Field label="カテゴリ">
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className={inputClass}
                  required
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="商品名">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  required
                  maxLength={60}
                />
              </Field>

              <Field label="提供パターン">
                <select
                  value={allowsTimingChoice ? 'choice' : 'immediate'}
                  onChange={(e) => setAllowsTimingChoice(e.target.value === 'choice')}
                  className={inputClass}
                >
                  <option value="immediate">即提供のみ</option>
                  <option value="choice">食中・食後を選択可能にする</option>
                </select>
              </Field>

              <Field label="価格(円)">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={inputClass}
                  required
                />
              </Field>

              <Field label="説明(任意)">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={inputClass}
                  rows={2}
                  maxLength={200}
                />
              </Field>

              <Field label="オプション">
                <select
                  value={hasOptions ? 'yes' : 'no'}
                  onChange={(e) => setHasOptions(e.target.value === 'yes')}
                  className={inputClass}
                >
                  <option value="no">オプションなし</option>
                  <option value="yes">オプションあり</option>
                </select>
              </Field>

              {hasOptions && (
                <div className="space-y-2 rounded-xl bg-stone-50 p-3">
                  {optionDrafts.map((draft, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        value={draft.name}
                        onChange={(e) =>
                          updateOptionDraft(index, { name: e.target.value })
                        }
                        placeholder="例: ごはん大盛"
                        className={`${inputClass} flex-1`}
                        maxLength={30}
                      />
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={draft.price}
                        onChange={(e) =>
                          updateOptionDraft(index, { price: e.target.value })
                        }
                        placeholder="100"
                        className={`${inputClass} w-24`}
                      />
                      <span className="shrink-0 text-sm text-stone-500">円</span>
                      {optionDrafts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeOptionDraftRow(index)}
                          aria-label="このオプション行を削除"
                          className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-100"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  ))}
                  <Button size="sm" tone="neutral" onClick={addOptionDraftRow}>
                    オプションをもう1つ追加
                  </Button>
                </div>
              )}

              {isDrinkCategory && (
                <div className="space-y-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                  <p className="text-xs font-medium text-amber-900">
                    セット割引(ドリンク以外の商品と同じ来店で注文すると自動で割引)。
                    空欄のままなら設定しません
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      value={comboDiscountName}
                      onChange={(e) => setComboDiscountName(e.target.value)}
                      placeholder="例: セット割引"
                      className={`${inputClass} flex-1`}
                      maxLength={30}
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={comboDiscountAmount}
                      onChange={(e) => setComboDiscountAmount(e.target.value)}
                      placeholder="100"
                      className={`${inputClass} w-24`}
                    />
                    <span className="shrink-0 text-sm text-stone-500">円引き</span>
                  </div>
                </div>
              )}

              <Button type="submit" disabled={saving}>
                {saving ? '追加しています…' : 'この内容で追加'}
              </Button>
            </form>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-bold">カテゴリ</h2>
              <Button
                size="sm"
                tone="neutral"
                onClick={() => setShowCategoryForm((v) => !v)}
              >
                {showCategoryForm ? '閉じる' : '追加'}
              </Button>
            </div>

            {showCategoryForm && (
              <form onSubmit={handleAddCategory} className="mt-4 space-y-3">
                <Field label="カテゴリ名">
                  <input
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    className={inputClass}
                    required
                    maxLength={30}
                  />
                </Field>
                <Button type="submit" disabled={saving}>
                  カテゴリを追加
                </Button>
              </form>
            )}

            <ul className="mt-4 space-y-2 text-sm">
              {categories.map((category) => (
                <li key={category.id}>{category.name}</li>
              ))}
            </ul>
          </Card>
        </div>

        {/* 商品一覧 */}
        <div className="space-y-5">
          {categories.map((category) => {
            const categoryItems = items.filter((i) => i.category_id === category.id);
            return (
              <Card key={category.id}>
                <h2 className="mb-3 flex items-center gap-2 font-bold">
                  {category.name}
                  <span className="text-sm font-medium text-stone-400">
                    {categoryItems.length}品
                  </span>
                </h2>

                {categoryItems.length === 0 ? (
                  <p className="py-4 text-sm text-stone-400">商品がありません</p>
                ) : (
                  <ul className="divide-y divide-stone-100">
                    {categoryItems.map((item) => (
                      <li key={item.id} className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p
                            className={`font-medium ${
                              item.is_available ? '' : 'text-stone-400'
                            }`}
                          >
                            {item.name}
                            {!item.is_available && (
                              <span className="ml-2">
                                <Badge tone="neutral">品切れ</Badge>
                              </span>
                            )}
                            {item.allows_timing_choice && (
                              <span className="ml-2">
                                <Badge tone="amber">食後選択可</Badge>
                              </span>
                            )}
                            {options.filter((o) => o.menu_item_id === item.id).length > 0 && (
                              <span className="ml-2">
                                <Badge tone="neutral">
                                  オプション{options.filter((o) => o.menu_item_id === item.id).length}件
                                </Badge>
                              </span>
                            )}
                            {item.combo_discount_amount > 0 && item.combo_discount_name && (
                              <span className="ml-2">
                                <Badge tone="emerald">
                                  {item.combo_discount_name} -{formatYen(item.combo_discount_amount)}
                                </Badge>
                              </span>
                            )}
                          </p>
                          {item.description && (
                            <p className="truncate text-xs text-stone-400">
                              {item.description}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => void changePrice(item)}
                          className="shrink-0 rounded-lg px-2 py-1 font-bold tabular-nums hover:bg-stone-100"
                          title="価格を変更"
                        >
                          {formatYen(item.price)}
                        </button>

                        <Button
                          size="sm"
                          tone={item.is_available ? 'neutral' : 'success'}
                          onClick={() => void toggleAvailable(item)}
                        >
                          {item.is_available ? '品切れにする' : '販売再開'}
                        </Button>

                        <Button
                          size="sm"
                          tone="neutral"
                          onClick={() => void toggleTimingChoice(item)}
                        >
                          {item.allows_timing_choice ? '即提供のみに戻す' : '食後選択可にする'}
                        </Button>

                        {category.is_drink && (
                          <Button
                            size="sm"
                            tone="neutral"
                            onClick={() => void changeComboDiscount(item)}
                          >
                            セット割引
                          </Button>
                        )}

                        <Button
                          size="sm"
                          tone="neutral"
                          onClick={() => {
                            setExpandedItemId((current) =>
                              current === item.id ? null : item.id,
                            );
                            setNewOptionName('');
                            setNewOptionPrice('');
                          }}
                        >
                          {expandedItemId === item.id ? 'オプションを閉じる' : 'オプション管理'}
                        </Button>

                        <button
                          type="button"
                          onClick={() => void handleDelete(item)}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50"
                        >
                          削除
                        </button>
                      </div>

                      {expandedItemId === item.id && (
                        <div className="mt-3 rounded-xl bg-stone-50 p-3">
                          {options.filter((o) => o.menu_item_id === item.id).length === 0 ? (
                            <p className="text-sm text-stone-400">
                              まだオプションがありません
                            </p>
                          ) : (
                            <ul className="space-y-2">
                              {options
                                .filter((o) => o.menu_item_id === item.id)
                                .map((option) => (
                                  <li
                                    key={option.id}
                                    className="flex items-center gap-2 text-sm"
                                  >
                                    <span className="flex-1">{option.name}</span>
                                    <button
                                      type="button"
                                      onClick={() => void handleChangeOptionPrice(option)}
                                      className="shrink-0 rounded-lg px-2 py-1 font-bold tabular-nums hover:bg-stone-200"
                                      title="追加料金を変更"
                                    >
                                      +{formatYen(option.extra_price)}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteOption(option)}
                                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-100"
                                    >
                                      削除
                                    </button>
                                  </li>
                                ))}
                            </ul>
                          )}

                          <div className="mt-3 flex items-center gap-2">
                            <input
                              value={newOptionName}
                              onChange={(e) => setNewOptionName(e.target.value)}
                              placeholder="例: 麺ダブル"
                              className={`${inputClass} flex-1`}
                              maxLength={30}
                            />
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              value={newOptionPrice}
                              onChange={(e) => setNewOptionPrice(e.target.value)}
                              placeholder="100"
                              className={`${inputClass} w-24`}
                            />
                            <span className="shrink-0 text-sm text-stone-500">円</span>
                            <Button
                              size="sm"
                              onClick={() => void handleAddOptionToItem(item.id)}
                            >
                              追加
                            </Button>
                          </div>
                        </div>
                      )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}

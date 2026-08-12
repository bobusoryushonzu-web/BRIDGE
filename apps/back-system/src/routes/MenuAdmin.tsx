/**
 * 商品管理 (BK-01 / BK-02 / BK-03 / BK-04)
 *
 * 削除は論理削除。物理削除すると過去の伝票が参照先を失うため。
 * 一時的に出せないだけなら「品切れ」を使う。
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Category, MenuItem } from '@bridge/shared';
import { formatYen } from '@bridge/shared';
import {
  createCategory,
  createMenuItem,
  deleteMenuItem,
  fetchCategories,
  fetchMenuItems,
  updateMenuItem,
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

export default function MenuAdmin() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
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

  // カテゴリ追加フォーム
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryName, setCategoryName] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextCategories, nextItems] = await Promise.all([
        fetchCategories(),
        fetchMenuItems(),
      ]);
      setCategories(nextCategories);
      setItems(nextItems);
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

  const handleAddItem = async (event: FormEvent) => {
    event.preventDefault();
    const priceValue = Number(price);
    if (!name.trim() || !categoryId) return;
    if (!Number.isInteger(priceValue) || priceValue < 0) {
      setError('価格は0以上の整数で入力してください');
      return;
    }

    setSaving(true);
    try {
      await createMenuItem({
        category_id: categoryId,
        name: name.trim(),
        price: priceValue,
        description: description.trim(),
        allows_timing_choice: allowsTimingChoice,
      });
      setName('');
      setPrice('');
      setDescription('');
      setAllowsTimingChoice(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加できませんでした');
    } finally {
      setSaving(false);
    }
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
                      <li key={item.id} className="flex items-center gap-3 py-3">
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

                        <button
                          type="button"
                          onClick={() => void handleDelete(item)}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50"
                        >
                          削除
                        </button>
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

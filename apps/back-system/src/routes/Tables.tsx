/**
 * 席・QR コード管理 (BK-14)
 *
 * QR コードは席ごとに固定。印刷して卓上に設置する。
 * QR 生成はブラウザ内で行い、外部サービスは使用しない。
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import type { TableRow } from '@bridge/shared';
import {
  createTable,
  fetchTables,
  setTableActive,
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

/** FRONT-system の公開 URL。未設定ならこの画面の入力値を使う */
const STORAGE_KEY = 'bridge.front_base_url';

export default function Tables() {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState('');
  const [saving, setSaving] = useState(false);

  const [baseUrl, setBaseUrl] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? '',
  );

  const load = useCallback(async () => {
    try {
      setTables(await fetchTables());
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

  const saveBaseUrl = (value: string) => {
    const trimmed = value.trim().replace(/\/+$/, '');
    setBaseUrl(trimmed);
    localStorage.setItem(STORAGE_KEY, trimmed);
  };

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (!tableNumber.trim()) return;
    setSaving(true);
    try {
      await createTable(tableNumber.trim(), tables.length + 1);
      setTableNumber('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (table: TableRow) => {
    try {
      await setTableActive(table.id, !table.is_active);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '変更できませんでした');
    }
  };

  const urlFor = (table: TableRow) => `${baseUrl}/t/${table.qr_token}`;

  if (loading) return <Spinner />;

  return (
    <>
      <PageTitle
        title="席・QR コード管理"
        description="各席に固定設置する QR コードを発行します"
        action={
          <Button tone="neutral" onClick={() => window.print()}>
            QR を印刷
          </Button>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="mb-6 print:hidden">
        <Card>
          <Field label="注文用アプリ(FRONT-system)の URL">
            <input
              value={baseUrl}
              onChange={(e) => saveBaseUrl(e.target.value)}
              placeholder="https://bridge-front.vercel.app"
              className={inputClass}
            />
          </Field>
          <p className="mt-2 text-xs text-stone-500">
            Vercel でデプロイした FRONT-system の URL を入力すると、QR コードが生成されます。
            この端末にのみ保存されます。
          </p>
        </Card>
      </div>

      <div className="mb-6 print:hidden">
        <Card>
          <h2 className="mb-3 font-bold">席を追加</h2>
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
            <div className="min-w-40 flex-1">
              <Field label="席番号">
                <input
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="11 / A-3 など"
                  className={inputClass}
                  required
                  maxLength={20}
                />
              </Field>
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? '追加しています…' : '追加'}
            </Button>
          </form>
        </Card>
      </div>

      {!baseUrl && (
        <div className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 print:hidden">
          QR コードを表示するには、上の欄に FRONT-system の URL を入力してください。
        </div>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((table) => (
          <li
            key={table.id}
            className="break-inside-avoid rounded-2xl bg-white p-5 text-center shadow-sm print:border print:border-stone-300 print:shadow-none"
          >
            <p className="text-3xl font-black tabular-nums">{table.table_number}</p>
            <p className="text-sm text-stone-500">番テーブル</p>

            <div className="my-4 flex justify-center">
              {baseUrl ? (
                <QRCodeCanvas
                  value={urlFor(table)}
                  size={168}
                  level="M"
                  includeMargin
                />
              ) : (
                <div className="grid size-[168px] place-items-center rounded-xl bg-stone-100 text-xs text-stone-400">
                  URL 未設定
                </div>
              )}
            </div>

            <p className="text-xs text-stone-400 print:hidden">
              {table.is_active ? (
                <Badge tone="emerald">利用中</Badge>
              ) : (
                <Badge tone="neutral">停止中</Badge>
              )}
            </p>

            <p className="mt-3 text-sm font-medium print:block hidden">
              メニューはこちら
            </p>

            <div className="mt-4 print:hidden">
              <Button
                size="sm"
                tone={table.is_active ? 'neutral' : 'success'}
                onClick={() => void toggleActive(table)}
              >
                {table.is_active ? '受付を停止' : '受付を再開'}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {tables.length === 0 && (
        <p className="py-16 text-center text-sm text-stone-500">
          席が登録されていません
        </p>
      )}
    </>
  );
}

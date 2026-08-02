/**
 * QR コードからの入店 (FR-01)
 *
 * 卓上の QR コードは /t/<トークン> を指す。ここでトークンを検証し、
 * 正しければ席情報を保存してメニューへ進む。
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSession } from '../lib/api';
import { clearTable, saveTable } from '../lib/table';
import { ErrorView, Spinner } from '../components/ui';

export default function Entry() {
  const { qrToken } = useParams<{ qrToken: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!qrToken) {
        setError('QR コードを読み取り直してください');
        return;
      }
      try {
        const result = await getSession(qrToken);
        if (cancelled) return;
        saveTable(qrToken, result.table.table_number);
        navigate('/menu', { replace: true });
      } catch (e) {
        if (cancelled) return;
        // 無効なトークンで入ってきた場合、古い席情報が残っていると
        // 別の席の伝票を触ってしまうため消しておく
        clearTable();
        setError(e instanceof Error ? e.message : '席を確認できませんでした');
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [qrToken, navigate]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg">
        <ErrorView message={error} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <Spinner label="お席を確認しています" />
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useOutletContext,
} from 'react-router-dom';
import type { CallType, GetBillResponse } from '@bridge/shared';
import { CartProvider } from './lib/cart';
import { getQrToken, getTableNumber } from './lib/table';
import { callStaff, getBill } from './lib/api';
import { BottomNav } from './components/BottomNav';
import { CallSheet } from './components/CallSheet';
import { Toast } from './components/ui';
import Entry from './routes/Entry';
import Menu from './routes/Menu';
import MyOrders from './routes/MyOrders';
import Bill from './routes/Bill';
import NoToken from './routes/NoToken';

/** 各画面が受け取る共有状態 */
export interface AppContext {
  qrToken: string;
  tableNumber: string | null;
  bill: GetBillResponse | null;
  reloadBill: () => Promise<void>;
  notify: (message: string) => void;
}

export function useAppContext(): AppContext {
  return useOutletContext<AppContext>();
}

/**
 * 共通レイアウト
 *
 * 伝票データはここで一元管理する。注文内容・会計・呼び出しシートの
 * いずれもこのデータを参照するため、画面ごとに取得すると表示がずれるため。
 */
function Layout() {
  const qrToken = getQrToken();
  const tableNumber = getTableNumber();

  const [bill, setBill] = useState<GetBillResponse | null>(null);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const reloadBill = useCallback(async () => {
    if (!qrToken) return;
    try {
      setBill(await getBill(qrToken));
    } catch {
      // 伝票の取得失敗は各画面側で表示する。ここでは無視してよい。
    }
  }, [qrToken]);

  useEffect(() => {
    void reloadBill();
  }, [reloadBill]);

  const handleCall = useCallback(
    async (type: CallType) => {
      if (!qrToken) return;
      try {
        await callStaff(qrToken, type);
        const messages: Record<CallType, string> = {
          bell: '店員をお呼びしました。少々お待ちください',
          serve_after: 'お預かりの商品をお持ちします',
          checkout: 'お会計をお伝えしました',
        };
        notify(messages[type]);
        await reloadBill();
      } catch (error) {
        notify(error instanceof Error ? error.message : '送信できませんでした');
      }
    },
    [qrToken, notify, reloadBill],
  );

  // QR を読み取っていない状態で直接アクセスされた場合
  if (!qrToken) {
    return <Navigate to="/start" replace />;
  }

  const context: AppContext = {
    qrToken,
    tableNumber,
    bill,
    reloadBill,
    notify,
  };

  return (
    <div className="mx-auto min-h-full max-w-lg pb-20">
      <Outlet context={context} />

      <BottomNav
        onOpenCall={() => setCallSheetOpen(true)}
        hasOpenCall={bill?.has_pending_after_items ?? false}
      />

      <CallSheet
        open={callSheetOpen}
        onClose={() => setCallSheetOpen(false)}
        onCall={handleCall}
        hasPendingAfterItems={bill?.has_pending_after_items ?? false}
      />

      {toast && <Toast message={toast} />}
    </div>
  );
}

export default function App() {
  return (
    <CartProvider>
      <Routes>
        {/* QR コードから開かれる入口 */}
        <Route path="/t/:qrToken" element={<Entry />} />
        <Route path="/start" element={<NoToken />} />

        <Route element={<Layout />}>
          <Route path="/menu" element={<Menu />} />
          <Route path="/orders" element={<MyOrders />} />
          <Route path="/bill" element={<Bill />} />
        </Route>

        <Route path="*" element={<Navigate to="/menu" replace />} />
      </Routes>
    </CartProvider>
  );
}

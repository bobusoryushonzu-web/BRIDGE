import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Spinner } from './components/ui';
import Login from './routes/Login';
import Dashboard from './routes/Dashboard';
import Serving from './routes/Serving';
import Orders from './routes/Orders';
import MenuAdmin from './routes/MenuAdmin';
import Tables from './routes/Tables';

const NAV = [
  { to: '/', label: 'ダッシュボード', icon: '🔔', end: true },
  { to: '/serving', label: '提供状況', icon: '🍳', end: false },
  { to: '/orders', label: '注文照会・会計', icon: '🧾', end: false },
  { to: '/menu', label: '商品管理', icon: '📖', end: false },
  { to: '/tables', label: '席・QR管理', icon: '🪑', end: false },
];

function Shell() {
  const { staff, signOut } = useAuth();

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-black tracking-widest">BRIDGE</span>
            <span className="hidden text-sm text-stone-400 sm:inline">管理パネル</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-stone-600">{staff?.display_name || '店員'}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg bg-stone-100 px-3 py-1.5 font-medium text-stone-600 hover:bg-stone-200"
            >
              ログアウト
            </button>
          </div>
        </div>

        <nav className="mx-auto max-w-6xl overflow-x-auto px-2">
          <div className="flex gap-1 pb-2">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition ${
                    isActive
                      ? 'bg-stone-800 text-white'
                      : 'text-stone-600 hover:bg-stone-100'
                  }`
                }
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

/** ログイン済みかつ staff_users に登録されている場合のみ通す */
function RequireStaff() {
  const { loading, session, staff } = useAuth();

  if (loading) return <Spinner label="確認しています" />;
  if (!session) return <Navigate to="/login" replace />;

  if (!staff) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-4 text-xl font-bold">利用権限がありません</h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          このアカウントは店員として登録されていません。
          <br />
          管理者に staff_users への登録を依頼してください。
        </p>
      </div>
    );
  }

  return <Shell />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireStaff />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/serving" element={<Serving />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/menu" element={<MenuAdmin />} />
          <Route path="/tables" element={<Tables />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

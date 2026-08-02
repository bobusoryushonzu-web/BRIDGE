/**
 * 画面下部の固定ナビゲーション
 * 客が迷わないよう、行える操作を4つに限定して常時表示する。
 */
import { NavLink } from 'react-router-dom';

interface Props {
  /** 「呼ぶ」タブは画面遷移ではなくシートを開く */
  onOpenCall: () => void;
  /** 未対応の呼び出しがある場合に印を出す */
  hasOpenCall?: boolean;
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition',
    isActive ? 'text-amber-700' : 'text-stone-500',
  ].join(' ');

export function BottomNav({ onOpenCall, hasOpenCall }: Props) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-lg items-stretch">
        <NavLink to="/menu" className={linkClass}>
          <span className="text-xl">🍽️</span>
          メニュー
        </NavLink>

        <NavLink to="/orders" className={linkClass}>
          <span className="text-xl">📋</span>
          注文内容
        </NavLink>

        <button
          type="button"
          onClick={onOpenCall}
          className="relative flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium text-stone-500"
        >
          <span className="text-xl">🔔</span>
          呼ぶ
          {hasOpenCall && (
            <span className="absolute right-1/4 top-1.5 size-2.5 rounded-full bg-red-500" />
          )}
        </button>

        <NavLink to="/bill" className={linkClass}>
          <span className="text-xl">💰</span>
          お会計
        </NavLink>
      </div>
    </nav>
  );
}

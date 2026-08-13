/**
 * カート状態
 *
 * 同じ商品でも「食中」と「食後」は別の行として扱う。
 * コーヒーを食中に1杯、食後に1杯といった注文ができるようにするため。
 * 同様に、選んだオプションの組み合わせが違えば別の行として扱う
 * (例: ごはん大盛あり1つ・なし1つを同時に注文できるように)。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PlaceOrderItem, ServeTiming } from '@bridge/shared';

export interface CartOption {
  id: string;
  name: string;
  extraPrice: number;
}

export interface CartLine {
  menuItemId: string;
  name: string;
  /** 基本価格(オプション代を含まない) */
  price: number;
  quantity: number;
  serveTiming: ServeTiming;
  options: CartOption[];
}

/** 基本価格に選択中オプションの追加料金を合算した、1点あたりの実質単価 */
export function lineUnitPrice(line: Pick<CartLine, 'price' | 'options'>): number {
  return line.price + line.options.reduce((sum, o) => sum + o.extraPrice, 0);
}

/** オプションIDを正規化した比較用の文字列(順序に依存しないようにソートする) */
function optionsKeyPart(options: CartOption[]): string {
  return [...options]
    .map((o) => o.id)
    .sort()
    .join(',');
}

/** カート行の一意キー。商品・提供タイミング・オプションの組み合わせ */
function lineKey(menuItemId: string, timing: ServeTiming, options: CartOption[]): string {
  return `${menuItemId}:${timing}:${optionsKeyPart(options)}`;
}

interface CartContextValue {
  lines: CartLine[];
  totalQuantity: number;
  totalAmount: number;
  /** 指定した商品・タイミング・オプションの組み合わせの数量 */
  quantityOf: (menuItemId: string, timing: ServeTiming, options: CartOption[]) => number;
  add: (line: Omit<CartLine, 'quantity'>) => void;
  remove: (menuItemId: string, timing: ServeTiming, options: CartOption[]) => void;
  clear: () => void;
  /** Edge Function に渡す形式へ変換する */
  toOrderItems: () => PlaceOrderItem[];
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, CartLine>>({});

  const add = useCallback((line: Omit<CartLine, 'quantity'>) => {
    const key = lineKey(line.menuItemId, line.serveTiming, line.options);
    setMap((prev) => {
      const current = prev[key];
      return {
        ...prev,
        [key]: current
          ? { ...current, quantity: Math.min(current.quantity + 1, 99) }
          : { ...line, quantity: 1 },
      };
    });
  }, []);

  const remove = useCallback(
    (menuItemId: string, timing: ServeTiming, options: CartOption[]) => {
      const key = lineKey(menuItemId, timing, options);
      setMap((prev) => {
        const current = prev[key];
        if (!current) return prev;
        if (current.quantity <= 1) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: { ...current, quantity: current.quantity - 1 } };
      });
    },
    [],
  );

  const clear = useCallback(() => setMap({}), []);

  const value = useMemo<CartContextValue>(() => {
    const lines = Object.values(map);
    return {
      lines,
      totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
      totalAmount: lines.reduce((sum, l) => sum + lineUnitPrice(l) * l.quantity, 0),
      quantityOf: (menuItemId, timing, options) =>
        map[lineKey(menuItemId, timing, options)]?.quantity ?? 0,
      add,
      remove,
      clear,
      toOrderItems: () =>
        lines.map((l) => ({
          menu_item_id: l.menuItemId,
          quantity: l.quantity,
          serve_timing: l.serveTiming,
          option_ids: l.options.map((o) => o.id),
        })),
    };
  }, [map, add, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart は CartProvider の内側でのみ使用できます');
  }
  return context;
}

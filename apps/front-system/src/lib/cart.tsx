/**
 * カート状態
 *
 * 同じ商品でも「食中」と「食後」は別の行として扱う。
 * コーヒーを食中に1杯、食後に1杯といった注文ができるようにするため。
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

export interface CartLine {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  serveTiming: ServeTiming;
}

/** カート行の一意キー。商品と提供タイミングの組み合わせ */
function lineKey(menuItemId: string, timing: ServeTiming): string {
  return `${menuItemId}:${timing}`;
}

interface CartContextValue {
  lines: CartLine[];
  totalQuantity: number;
  totalAmount: number;
  /** 指定した商品・タイミングの数量 */
  quantityOf: (menuItemId: string, timing: ServeTiming) => number;
  add: (line: Omit<CartLine, 'quantity'>) => void;
  remove: (menuItemId: string, timing: ServeTiming) => void;
  clear: () => void;
  /** Edge Function に渡す形式へ変換する */
  toOrderItems: () => PlaceOrderItem[];
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, CartLine>>({});

  const add = useCallback((line: Omit<CartLine, 'quantity'>) => {
    const key = lineKey(line.menuItemId, line.serveTiming);
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

  const remove = useCallback((menuItemId: string, timing: ServeTiming) => {
    const key = lineKey(menuItemId, timing);
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
  }, []);

  const clear = useCallback(() => setMap({}), []);

  const value = useMemo<CartContextValue>(() => {
    const lines = Object.values(map);
    return {
      lines,
      totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
      totalAmount: lines.reduce((sum, l) => sum + l.price * l.quantity, 0),
      quantityOf: (menuItemId, timing) =>
        map[lineKey(menuItemId, timing)]?.quantity ?? 0,
      add,
      remove,
      clear,
      toOrderItems: () =>
        lines.map((l) => ({
          menu_item_id: l.menuItemId,
          quantity: l.quantity,
          serve_timing: l.serveTiming,
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

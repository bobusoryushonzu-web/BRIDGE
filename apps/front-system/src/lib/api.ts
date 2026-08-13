/**
 * Edge Functions の呼び出しラッパー
 *
 * 客側の書き込み操作はすべてここを通る。データベースへ直接 INSERT することはない。
 */
import type {
  CallStaffResponse,
  CallType,
  Category,
  GetBillResponse,
  GetSessionResponse,
  MenuItem,
  MenuItemOption,
  PlaceOrderItem,
  PlaceOrderResponse,
} from '@bridge/shared';
import { supabase } from './supabase';

/** Edge Function が返したエラーメッセージを取り出す */
async function extractErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body && typeof body.error === 'string') return body.error;
    } catch {
      // JSON でない応答(ネットワーク断など)はそのまま既定の文言にする
    }
  }
  const message = (error as { message?: string }).message;
  return message ?? '通信に失敗しました。電波状況をご確認ください';
}

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(fn, { body });
  if (error) {
    throw new Error(await extractErrorMessage(error));
  }
  if (data === null) {
    throw new Error('サーバーから応答がありませんでした');
  }
  return data;
}

/** QR トークンから席と未会計セッションを取得する (FR-01) */
export function getSession(qrToken: string) {
  return invoke<GetSessionResponse>('get-session', { qr_token: qrToken });
}

/** 注文を確定する (FR-04) */
export function placeOrder(qrToken: string, items: PlaceOrderItem[]) {
  return invoke<PlaceOrderResponse>('place-order', { qr_token: qrToken, items });
}

/** 未会計の全注文をまとめた伝票を取得する (FR-05 / FR-09) */
export function getBill(qrToken: string) {
  return invoke<GetBillResponse>('get-bill', { qr_token: qrToken });
}

/** 呼び鈴・食後提供の合図・会計依頼 (FR-06 / FR-07 / FR-08) */
export function callStaff(qrToken: string, type: CallType) {
  return invoke<CallStaffResponse>('call-staff', { qr_token: qrToken, type });
}

/**
 * メニューの取得 (FR-02)
 *
 * メニューは客も読めるように行レベルセキュリティで許可しているため、
 * Edge Function を介さず直接読む。呼び出し回数を節約でき、表示も速い。
 */
export async function fetchMenu(): Promise<{
  categories: Category[];
  items: MenuItem[];
  options: MenuItemOption[];
}> {
  const [categoriesResult, itemsResult, optionsResult] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('menu_items').select('*').order('sort_order'),
    supabase.from('menu_item_options').select('*').order('sort_order'),
  ]);

  if (categoriesResult.error || itemsResult.error || optionsResult.error) {
    throw new Error('メニューの読み込みに失敗しました');
  }

  return {
    categories: (categoriesResult.data ?? []) as Category[],
    items: (itemsResult.data ?? []) as MenuItem[],
    options: (optionsResult.data ?? []) as MenuItemOption[],
  };
}

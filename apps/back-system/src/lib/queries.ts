/**
 * BACK-system のデータ取得・更新
 *
 * 店員は認証済みで行レベルセキュリティに守られているため、
 * Edge Functions を介さず Supabase クライアントから直接読み書きする。
 */
import type {
  Category,
  MenuItem,
  MenuItemOption,
  SessionSummary,
  StaffCall,
  TableRow,
} from '@bridge/shared';
import { supabase } from './supabase';

// ============================================================
// 未対応の呼び出し (BK-09 / BK-10 / BK-11)
// ============================================================

/** 商品名にオプションがあれば括弧書きで添える(例: 「ティラミス(ホイップ増量)」) */
function withOptionLabel(itemName: string, options: { option_name: string }[]): string {
  if (options.length === 0) return itemName;
  return `${itemName}(${options.map((o) => o.option_name).join('・')})`;
}

export interface OpenCall extends StaffCall {
  table_number: string;
  /** 食後提供の合図に対して、実際に保留されている商品名 */
  pending_after_items: string[];
}

export async function fetchOpenCalls(): Promise<OpenCall[]> {
  const { data, error } = await supabase
    .from('staff_calls')
    .select('*, sessions!inner(id, tables!inner(table_number))')
    .eq('status', 'open')
    .order('created_at', { ascending: true });

  if (error) throw new Error('呼び出しの読み込みに失敗しました');

  type Row = StaffCall & {
    sessions: { id: string; tables: { table_number: string } };
  };
  const rows = (data ?? []) as unknown as Row[];

  // 食後提供の合図には、どの商品を出すのかを添える。
  // 店員が伝票を開き直さずに動けるようにするため。
  const serveAfterSessionIds = rows
    .filter((row) => row.type === 'serve_after')
    .map((row) => row.session_id);

  const pendingBySession = new Map<string, string[]>();
  if (serveAfterSessionIds.length > 0) {
    const { data: items } = await supabase
      .from('order_items')
      .select(
        'item_name, quantity, order_item_options(option_name), orders!inner(session_id)',
      )
      .eq('status', 'pending')
      .eq('serve_timing', 'after')
      .in('orders.session_id', serveAfterSessionIds);

    type ItemRow = {
      item_name: string;
      quantity: number;
      order_item_options: { option_name: string }[];
      orders: { session_id: string };
    };
    for (const item of (items ?? []) as unknown as ItemRow[]) {
      const list = pendingBySession.get(item.orders.session_id) ?? [];
      const label = withOptionLabel(item.item_name, item.order_item_options ?? []);
      list.push(item.quantity > 1 ? `${label}×${item.quantity}` : label);
      pendingBySession.set(item.orders.session_id, list);
    }
  }

  return rows.map((row) => ({
    ...row,
    table_number: row.sessions.tables.table_number,
    pending_after_items: pendingBySession.get(row.session_id) ?? [],
  }));
}

export async function handleCall(callId: string, staffId: string): Promise<void> {
  const { error } = await supabase
    .from('staff_calls')
    .update({ status: 'handled', handled_at: new Date().toISOString(), handled_by: staffId })
    .eq('id', callId);
  if (error) throw new Error('対応済みにできませんでした');
}

// ============================================================
// 新着注文 (BK-08)
// ============================================================

export interface RecentOrder {
  id: string;
  created_at: string;
  table_number: string;
  session_id: string;
  items: {
    id: string;
    /** オプション名を括弧書きで含んだ表示用の商品名 */
    item_name: string;
    quantity: number;
    serve_timing: 'during' | 'after';
    status: 'pending' | 'served';
  }[];
}

export async function fetchRecentOrders(limit = 20): Promise<RecentOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, created_at, session_id, sessions!inner(tables!inner(table_number)), order_items(id, item_name, quantity, serve_timing, status, order_item_options(option_name))',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error('注文の読み込みに失敗しました');

  type ItemRow = {
    id: string;
    item_name: string;
    quantity: number;
    serve_timing: 'during' | 'after';
    status: 'pending' | 'served';
    order_item_options: { option_name: string }[];
  };
  type Row = {
    id: string;
    created_at: string;
    session_id: string;
    sessions: { tables: { table_number: string } };
    order_items: ItemRow[];
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    session_id: row.session_id,
    table_number: row.sessions.tables.table_number,
    items: (row.order_items ?? []).map((item) => ({
      id: item.id,
      item_name: withOptionLabel(item.item_name, item.order_item_options ?? []),
      quantity: item.quantity,
      serve_timing: item.serve_timing,
      status: item.status,
    })),
  }));
}

// ============================================================
// 提供状況 (BK-06 / BK-07)
// ============================================================

export interface PendingItem {
  id: string;
  item_name: string;
  quantity: number;
  serve_timing: 'during' | 'after';
  created_at: string;
  session_id: string;
  table_number: string;
}

export async function fetchPendingItems(): Promise<PendingItem[]> {
  const { data, error } = await supabase
    .from('order_items')
    .select(
      'id, item_name, quantity, serve_timing, created_at, order_item_options(option_name), orders!inner(session_id, sessions!inner(status, tables!inner(table_number)))',
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw new Error('提供状況の読み込みに失敗しました');

  type Row = {
    id: string;
    item_name: string;
    quantity: number;
    serve_timing: 'during' | 'after';
    created_at: string;
    order_item_options: { option_name: string }[];
    orders: {
      session_id: string;
      sessions: { status: string; tables: { table_number: string } };
    };
  };

  return ((data ?? []) as unknown as Row[])
    // 会計済みセッションの残りは対応不要なので除く
    .filter((row) => row.orders.sessions.status !== 'closed')
    .map((row) => ({
      id: row.id,
      item_name: withOptionLabel(row.item_name, row.order_item_options ?? []),
      quantity: row.quantity,
      serve_timing: row.serve_timing,
      created_at: row.created_at,
      session_id: row.orders.session_id,
      table_number: row.orders.sessions.tables.table_number,
    }));
}

export async function markServed(itemId: string): Promise<void> {
  const { error } = await supabase
    .from('order_items')
    .update({ status: 'served', served_at: new Date().toISOString() })
    .eq('id', itemId);
  if (error) throw new Error('提供済みにできませんでした');
}

export async function markUnserved(itemId: string): Promise<void> {
  const { error } = await supabase
    .from('order_items')
    .update({ status: 'pending', served_at: null })
    .eq('id', itemId);
  if (error) throw new Error('取り消せませんでした');
}

// ============================================================
// 注文照会・会計 (BK-05 / BK-12)
// ============================================================

export async function fetchSessions(includeClosed: boolean): Promise<SessionSummary[]> {
  let query = supabase.from('v_session_summary').select('*');
  if (!includeClosed) query = query.neq('status', 'closed');

  const { data, error } = await query.order('opened_at', { ascending: false }).limit(100);
  if (error) throw new Error('伝票の読み込みに失敗しました');
  return (data ?? []) as SessionSummary[];
}

export interface BillItem {
  id: string;
  /** オプション名を括弧書きで含んだ表示用の商品名 */
  item_name: string;
  unit_price: number;
  quantity: number;
  serve_timing: 'during' | 'after';
  status: 'pending' | 'served';
  created_at: string;
}

export async function fetchSessionItems(sessionId: string): Promise<BillItem[]> {
  const { data, error } = await supabase
    .from('order_items')
    .select(
      'id, item_name, unit_price, quantity, serve_timing, status, created_at, order_item_options(option_name), orders!inner(session_id)',
    )
    .eq('orders.session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error('明細の読み込みに失敗しました');

  type Row = BillItem & { order_item_options: { option_name: string }[] };
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    item_name: withOptionLabel(row.item_name, row.order_item_options ?? []),
    unit_price: row.unit_price,
    quantity: row.quantity,
    serve_timing: row.serve_timing,
    status: row.status,
    created_at: row.created_at,
  }));
}

/** 誤注文の取り消し。伝票から明細を削除する */
export async function deleteOrderItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('order_items').delete().eq('id', itemId);
  if (error) throw new Error('明細を取り消せませんでした');
}

/** 会計完了。セッションを閉じ、席を次の客に開放する (BK-12) */
export async function closeSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) throw new Error('会計を完了できませんでした');

  // その席に残っている未対応の呼び出しも閉じる
  await supabase
    .from('staff_calls')
    .update({ status: 'handled', handled_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .eq('status', 'open');
}

// ============================================================
// 商品管理 (BK-01〜04)
// ============================================================

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('is_deleted', false)
    .order('sort_order');
  if (error) throw new Error('カテゴリの読み込みに失敗しました');
  return (data ?? []) as Category[];
}

export async function fetchMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('is_deleted', false)
    .order('sort_order');
  if (error) throw new Error('商品の読み込みに失敗しました');
  return (data ?? []) as MenuItem[];
}

/** 追加した商品の id を返す。追加直後にオプションを紐づけるために使う */
export async function createMenuItem(input: {
  category_id: string;
  name: string;
  price: number;
  description: string;
  /** 客が「食中/食後」を選べる商品か */
  allows_timing_choice: boolean;
}): Promise<string> {
  const { data, error } = await supabase
    .from('menu_items')
    .insert(input)
    .select('id')
    .single();
  if (error || !data) throw new Error('商品を追加できませんでした');
  return data.id as string;
}

export async function updateMenuItem(
  id: string,
  patch: Partial<
    Pick<
      MenuItem,
      'name' | 'price' | 'description' | 'is_available' | 'allows_timing_choice'
    >
  >,
): Promise<void> {
  const { error } = await supabase.from('menu_items').update(patch).eq('id', id);
  if (error) throw new Error('商品を更新できませんでした');
}

/**
 * 商品の削除 (BK-02)
 * 物理削除すると過去の伝票が参照先を失うため論理削除にする。
 */
export async function deleteMenuItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('menu_items')
    .update({ is_deleted: true })
    .eq('id', id);
  if (error) throw new Error('商品を削除できませんでした');
}

export async function createCategory(input: {
  name: string;
  sort_order: number;
}): Promise<void> {
  const { error } = await supabase.from('categories').insert(input);
  if (error) throw new Error('カテゴリを追加できませんでした');
}

// ============================================================
// 席・QR 管理 (BK-14)
// ============================================================

export async function fetchTables(): Promise<TableRow[]> {
  const { data, error } = await supabase
    .from('tables')
    .select('*')
    .order('sort_order');
  if (error) throw new Error('席の読み込みに失敗しました');
  return (data ?? []) as TableRow[];
}

export async function createTable(tableNumber: string, sortOrder: number): Promise<void> {
  const { error } = await supabase
    .from('tables')
    .insert({ table_number: tableNumber, sort_order: sortOrder });
  if (error) throw new Error('席を追加できませんでした(番号が重複していませんか)');
}

export async function setTableActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('tables')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) throw new Error('席の状態を変更できませんでした');
}

// ============================================================
// 商品オプション(例: ご飯大盛+50円)
// ============================================================

export async function fetchMenuItemOptions(): Promise<MenuItemOption[]> {
  const { data, error } = await supabase
    .from('menu_item_options')
    .select('*')
    .eq('is_deleted', false)
    .order('sort_order');
  if (error) throw new Error('オプションの読み込みに失敗しました');
  return (data ?? []) as MenuItemOption[];
}

export async function createMenuItemOption(input: {
  menu_item_id: string;
  name: string;
  extra_price: number;
  sort_order: number;
}): Promise<void> {
  const { error } = await supabase.from('menu_item_options').insert(input);
  if (error) throw new Error('オプションを追加できませんでした');
}

export async function updateMenuItemOption(
  id: string,
  patch: Partial<Pick<MenuItemOption, 'name' | 'extra_price'>>,
): Promise<void> {
  const { error } = await supabase
    .from('menu_item_options')
    .update(patch)
    .eq('id', id);
  if (error) throw new Error('オプションを更新できませんでした');
}

/** オプションの削除は論理削除。過去の伝票は order_item_options に別途保存されているため影響しない */
export async function deleteMenuItemOption(id: string): Promise<void> {
  const { error } = await supabase
    .from('menu_item_options')
    .update({ is_deleted: true })
    .eq('id', id);
  if (error) throw new Error('オプションを削除できませんでした');
}

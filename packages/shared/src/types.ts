/**
 * BRIDGE 共通型定義
 *
 * データベースのスキーマ (supabase/migrations) と対応する。
 * スキーマを変更した場合はここも更新すること。
 */

// ============================================================
// 列挙型
// ============================================================

/** 提供タイミング: 食中 / 食後 */
export type ServeTiming = 'during' | 'after';

/** 注文明細の提供状況 */
export type ItemStatus = 'pending' | 'served';

/** 会計セッションの状態 */
export type SessionStatus = 'active' | 'checkout_requested' | 'closed';

/** 呼び出しの種類 */
export type CallType = 'bell' | 'serve_after' | 'checkout';

/** 呼び出しの対応状況 */
export type CallStatus = 'open' | 'handled';

/** 店員の権限 */
export type StaffRole = 'admin' | 'staff';

// ============================================================
// テーブル行
// ============================================================

export interface TableRow {
  id: string;
  table_number: string;
  qr_token: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  /** ドリンクカテゴリか。true の場合のみ商品ごとにセット割引を設定できる */
  is_drink: boolean;
  sort_order: number;
  is_deleted: boolean;
  created_at: string;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  price: number;
  description: string;
  /** 客が「食中/食後」を選べる商品か。商品ごとに店員が設定する */
  allows_timing_choice: boolean;
  /** セット割引の名称(例: 'セット割引')。未設定なら null */
  combo_discount_name: string | null;
  /** セット割引の金額(円、1点あたり)。0なら割引なし */
  combo_discount_amount: number;
  /** 品切れでないか */
  is_available: boolean;
  /** 論理削除フラグ */
  is_deleted: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  table_id: string;
  status: SessionStatus;
  opened_at: string;
  closed_at: string | null;
}

export interface Order {
  id: string;
  session_id: string;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  /** 注文時点の商品名のコピー */
  item_name: string;
  /** 注文時点の単価のコピー */
  unit_price: number;
  quantity: number;
  serve_timing: ServeTiming;
  status: ItemStatus;
  served_at: string | null;
  created_at: string;
}

export interface StaffCall {
  id: string;
  session_id: string;
  type: CallType;
  status: CallStatus;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
}

export interface StaffUser {
  id: string;
  display_name: string;
  role: StaffRole;
  created_at: string;
}

/** 商品オプション(例: ご飯大盛+50円)。商品ごとに0件以上持つ */
export interface MenuItemOption {
  id: string;
  menu_item_id: string;
  name: string;
  /** 追加料金(1点あたり) */
  extra_price: number;
  is_deleted: boolean;
  sort_order: number;
  created_at: string;
}

/** v_session_summary ビュー(BACK-system の注文照会用) */
export interface SessionSummary {
  session_id: string;
  table_id: string;
  table_number: string;
  status: SessionStatus;
  opened_at: string;
  closed_at: string | null;
  total_amount: number;
  item_count: number;
  pending_count: number;
}

// ============================================================
// Edge Functions の入出力
// ============================================================

/** 席の最小情報。qr_token は含めない */
export interface TableInfo {
  id: string;
  table_number: string;
}

/** get-session のレスポンス */
export interface GetSessionResponse {
  table: TableInfo;
  /** まだ一度も注文していない場合は null */
  session: { id: string; status: SessionStatus } | null;
}

/** place-order のリクエスト明細 */
export interface PlaceOrderItem {
  menu_item_id: string;
  quantity: number;
  serve_timing: ServeTiming;
  /** 選択したオプションのID一覧(選ばなければ空配列) */
  option_ids: string[];
}

/** place-order のレスポンス */
export interface PlaceOrderResponse {
  order_id: string;
  session_id: string;
}

/** 伝票1行に含まれる、選択されたオプション */
export interface BillLineOption {
  name: string;
  extra_price: number;
}

/** 伝票の1行 */
export interface BillLine {
  id: string;
  item_name: string;
  /** 選んだオプションの追加料金を含んだ単価 */
  unit_price: number;
  quantity: number;
  subtotal: number;
  serve_timing: ServeTiming;
  status: ItemStatus;
  ordered_at: string;
  options: BillLineOption[];
}

/** get-bill のレスポンス(FR-05 注文内容確認 / FR-09 デジタル伝票) */
export interface GetBillResponse {
  table: TableInfo;
  session: { id: string; status: SessionStatus; opened_at: string } | null;
  lines: BillLine[];
  total: number;
  /** 食後指定で未提供の商品があるか(FR-07 のボタン表示判定に使う) */
  has_pending_after_items: boolean;
}

/** call-staff のレスポンス */
export interface CallStaffResponse {
  call_id: string;
  type: CallType;
}

/** Edge Functions のエラー応答 */
export interface ApiError {
  error: string;
}

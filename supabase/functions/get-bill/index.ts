/**
 * get-bill (FR-05 / FR-09)
 *
 * その席の未会計セッションに属する全注文を1つにまとめて返す。
 * 「注文内容と提供状況の確認」と「会計時のデジタル伝票」の両方に使う。
 */
import {
  adminClient,
  errorResponse,
  findOpenSession,
  handlePreflight,
  jsonResponse,
  readJson,
  resolveTable,
} from '../_shared/utils.ts';

interface ItemRow {
  id: string;
  item_name: string;
  unit_price: number;
  quantity: number;
  serve_timing: 'during' | 'after';
  status: 'pending' | 'served';
  created_at: string;
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse('POST のみ受け付けます', 405);
  }

  const body = await readJson(req);
  if (!body) return errorResponse('リクエストの形式が不正です', 400);

  const admin = adminClient();

  const table = await resolveTable(admin, body.qr_token);
  if (!table) {
    return errorResponse('この QR コードは無効です。店員にお知らせください', 404);
  }

  const session = await findOpenSession(admin, table.id);

  // まだ一度も注文していない席は空の伝票を返す
  if (!session) {
    return jsonResponse({
      table,
      session: null,
      lines: [],
      total: 0,
      has_pending_after_items: false,
    });
  }

  const { data: orders, error: ordersError } = await admin
    .from('orders')
    .select('id')
    .eq('session_id', session.id);

  if (ordersError) {
    return errorResponse('伝票の読み込みに失敗しました', 500);
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) {
    return jsonResponse({
      table,
      session: {
        id: session.id,
        status: session.status,
        opened_at: session.opened_at,
      },
      lines: [],
      total: 0,
      has_pending_after_items: false,
    });
  }

  const { data: items, error: itemsError } = await admin
    .from('order_items')
    .select('id, item_name, unit_price, quantity, serve_timing, status, created_at')
    .in('order_id', orderIds)
    .order('created_at', { ascending: true });

  if (itemsError) {
    return errorResponse('伝票の読み込みに失敗しました', 500);
  }

  const rows = (items ?? []) as ItemRow[];

  const lines = rows.map((row) => ({
    id: row.id,
    item_name: row.item_name,
    unit_price: row.unit_price,
    quantity: row.quantity,
    subtotal: row.unit_price * row.quantity,
    serve_timing: row.serve_timing,
    status: row.status,
    ordered_at: row.created_at,
  }));

  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);

  // 「食後の商品を出してほしい」ボタン(FR-07)を出すかどうかの判定に使う
  const hasPendingAfterItems = rows.some(
    (row) => row.serve_timing === 'after' && row.status === 'pending',
  );

  return jsonResponse({
    table,
    session: {
      id: session.id,
      status: session.status,
      opened_at: session.opened_at,
    },
    lines,
    total,
    has_pending_after_items: hasPendingAfterItems,
  });
});

/**
 * place-order (FR-04)
 *
 * 注文を確定する。クライアントから受け取るのは「どの商品を何個、いつ出すか」だけで、
 * 商品名・価格・提供タイミングの妥当性はすべてデータベース側の値で決め直す。
 * 価格を改ざんしたリクエストが来ても通らない。
 */
import {
  adminClient,
  closeStaleSessions,
  errorResponse,
  handlePreflight,
  jsonResponse,
  readJson,
  resolveTable,
} from '../_shared/utils.ts';

/** 1回の注文で送れる明細の上限。異常なリクエストを弾く */
const MAX_LINES = 50;
const MAX_QUANTITY = 99;

interface RequestLine {
  menu_item_id: string;
  quantity: number;
  serve_timing: 'during' | 'after';
}

/** リクエストの明細を検証して正規化する */
function parseLines(raw: unknown): RequestLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null;

  const lines: RequestLine[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { menu_item_id, quantity, serve_timing } = entry as Record<string, unknown>;

    if (typeof menu_item_id !== 'string' || menu_item_id.length === 0) return null;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity)) return null;
    if (quantity < 1 || quantity > MAX_QUANTITY) return null;
    if (serve_timing !== 'during' && serve_timing !== 'after') return null;

    lines.push({ menu_item_id, quantity, serve_timing });
  }
  return lines;
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse('POST のみ受け付けます', 405);
  }

  const body = await readJson(req);
  if (!body) return errorResponse('リクエストの形式が不正です', 400);

  const lines = parseLines(body.items);
  if (!lines) return errorResponse('注文内容が不正です', 400);

  const admin = adminClient();

  const table = await resolveTable(admin, body.qr_token);
  if (!table) {
    return errorResponse('この QR コードは無効です。店員にお知らせください', 404);
  }

  await closeStaleSessions(admin);

  // ---- 商品の実在・販売可否をデータベース側で確認する ----
  const ids = [...new Set(lines.map((l) => l.menu_item_id))];
  const { data: menuRows, error: menuError } = await admin
    .from('menu_items')
    .select('id, name, price, is_available, is_deleted, categories(allows_timing_choice)')
    .in('id', ids);

  if (menuError) {
    return errorResponse('メニューの読み込みに失敗しました', 500);
  }

  type MenuRow = {
    id: string;
    name: string;
    price: number;
    is_available: boolean;
    is_deleted: boolean;
    categories: { allows_timing_choice: boolean } | null;
  };
  const menuById = new Map<string, MenuRow>(
    ((menuRows ?? []) as unknown as MenuRow[]).map((m) => [m.id, m]),
  );

  const soldOut: string[] = [];
  for (const id of ids) {
    const item = menuById.get(id);
    if (!item || item.is_deleted) {
      return errorResponse('取り扱いのない商品が含まれています', 400);
    }
    if (!item.is_available) soldOut.push(item.name);
  }
  if (soldOut.length > 0) {
    return errorResponse(
      `申し訳ありません。${soldOut.join('、')}は品切れです。ご注文から外してください`,
      409,
    );
  }

  // ---- セッションを取得または作成 ----
  const { data: sessionId, error: sessionError } = await admin.rpc(
    'fn_get_or_create_session',
    { p_table_id: table.id },
  );
  if (sessionError || !sessionId) {
    return errorResponse('席の利用開始に失敗しました', 500);
  }

  // ---- 注文を作成 ----
  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({ session_id: sessionId })
    .select('id')
    .single();

  if (orderError || !order) {
    return errorResponse('注文の登録に失敗しました', 500);
  }

  // 商品名と単価はデータベースの値をコピーする(クライアントの申告値は使わない)。
  // 提供タイミングも、カテゴリが選択を許していなければ「食中」に矯正する。
  const rows = lines.map((line) => {
    const item = menuById.get(line.menu_item_id)!;
    const allowsChoice = item.categories?.allows_timing_choice ?? false;
    return {
      order_id: order.id,
      menu_item_id: item.id,
      item_name: item.name,
      unit_price: item.price,
      quantity: line.quantity,
      serve_timing: allowsChoice ? line.serve_timing : 'during',
    };
  });

  const { error: itemsError } = await admin.from('order_items').insert(rows);
  if (itemsError) {
    // 明細のない空の注文が残ると店員の画面を汚すため取り消す
    await admin.from('orders').delete().eq('id', order.id);
    return errorResponse('注文の登録に失敗しました', 500);
  }

  return jsonResponse({ order_id: order.id, session_id: sessionId });
});

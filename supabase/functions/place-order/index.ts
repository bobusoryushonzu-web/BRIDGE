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
/** 1明細あたりのオプション数の上限 */
const MAX_OPTIONS_PER_LINE = 10;

interface RequestLine {
  menu_item_id: string;
  quantity: number;
  serve_timing: 'during' | 'after';
  option_ids: string[];
}

/** リクエストの明細を検証して正規化する */
function parseLines(raw: unknown): RequestLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null;

  const lines: RequestLine[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { menu_item_id, quantity, serve_timing, option_ids } =
      entry as Record<string, unknown>;

    if (typeof menu_item_id !== 'string' || menu_item_id.length === 0) return null;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity)) return null;
    if (quantity < 1 || quantity > MAX_QUANTITY) return null;
    if (serve_timing !== 'during' && serve_timing !== 'after') return null;

    let optionIds: string[] = [];
    if (option_ids !== undefined) {
      if (
        !Array.isArray(option_ids) ||
        option_ids.length > MAX_OPTIONS_PER_LINE ||
        !option_ids.every((v) => typeof v === 'string' && v.length > 0)
      ) {
        return null;
      }
      optionIds = [...new Set(option_ids as string[])];
    }

    lines.push({ menu_item_id, quantity, serve_timing, option_ids: optionIds });
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
    .select(
      'id, name, price, is_available, is_deleted, allows_timing_choice, category_id, combo_discount_name, combo_discount_amount',
    )
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
    allows_timing_choice: boolean;
    category_id: string;
    combo_discount_name: string | null;
    combo_discount_amount: number;
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

  // ---- ドリンクのセット割引判定に使う、カテゴリごとのドリンク区分を取得する ----
  const categoryIds = [
    ...new Set(((menuRows ?? []) as unknown as MenuRow[]).map((m) => m.category_id)),
  ];
  const { data: categoryRows, error: categoryError } = await admin
    .from('categories')
    .select('id, is_drink')
    .in('id', categoryIds);

  if (categoryError) {
    return errorResponse('カテゴリの読み込みに失敗しました', 500);
  }
  const isDrinkByCategory = new Map<string, boolean>(
    ((categoryRows ?? []) as { id: string; is_drink: boolean }[]).map((c) => [
      c.id,
      c.is_drink,
    ]),
  );
  const isDrinkItem = (item: MenuRow) => isDrinkByCategory.get(item.category_id) ?? false;

  // ---- オプションの実在・商品との対応をデータベース側で確認する ----
  const optionIds = [...new Set(lines.flatMap((l) => l.option_ids))];
  type OptionRow = {
    id: string;
    menu_item_id: string;
    name: string;
    extra_price: number;
  };
  let optionById = new Map<string, OptionRow>();
  if (optionIds.length > 0) {
    const { data: optionRows, error: optionError } = await admin
      .from('menu_item_options')
      .select('id, menu_item_id, name, extra_price')
      .eq('is_deleted', false)
      .in('id', optionIds);

    if (optionError) {
      return errorResponse('オプションの読み込みに失敗しました', 500);
    }
    optionById = new Map(
      ((optionRows ?? []) as OptionRow[]).map((o) => [o.id, o]),
    );

    for (const line of lines) {
      for (const optionId of line.option_ids) {
        const option = optionById.get(optionId);
        if (!option || option.menu_item_id !== line.menu_item_id) {
          return errorResponse('選択されたオプションが不正です', 400);
        }
      }
    }
  }

  // ---- セッションを取得または作成 ----
  const { data: sessionId, error: sessionError } = await admin.rpc(
    'fn_get_or_create_session',
    { p_table_id: table.id },
  );
  if (sessionError || !sessionId) {
    return errorResponse('席の利用開始に失敗しました', 500);
  }

  // ---- ドリンクのセット割引: 来店中にドリンク以外の商品を注文済みか ----
  // 今回の注文にドリンク以外が含まれていれば、その時点で条件を満たす。
  // 含まれていなければ、同じセッションの過去の注文明細(category_is_drink
  // にスナップショットしてある)を確認する。
  let sessionHasNonDrink = lines.some((line) => !isDrinkItem(menuById.get(line.menu_item_id)!));
  if (!sessionHasNonDrink) {
    const { count: nonDrinkCount, error: historyError } = await admin
      .from('order_items')
      .select('id, orders!inner(session_id)', { count: 'exact', head: true })
      .eq('category_is_drink', false)
      .eq('orders.session_id', sessionId);

    if (historyError) {
      return errorResponse('セッションの読み込みに失敗しました', 500);
    }
    sessionHasNonDrink = (nonDrinkCount ?? 0) > 0;
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
  // 提供タイミングも、その商品が選択を許していなければ「食中」に矯正する。
  // unit_price には選んだオプションの追加料金を合算し、セット割引が
  // 適用できるドリンクなら割引額を差し引く。こうすることで伝票合計や
  // 売上集計は order_items.unit_price × quantity のままで済む。
  const discounts: ({ name: string; amount: number } | null)[] = [];
  const rows = lines.map((line) => {
    const item = menuById.get(line.menu_item_id)!;
    const options = line.option_ids.map((id) => optionById.get(id)!);
    const optionsTotal = options.reduce((sum, o) => sum + o.extra_price, 0);

    const discountEligible =
      isDrinkItem(item) &&
      sessionHasNonDrink &&
      item.combo_discount_amount > 0 &&
      !!item.combo_discount_name;
    // 割引額が価格を上回っても単価が負にならないようにする
    const discountAmount = discountEligible
      ? Math.min(item.combo_discount_amount, item.price)
      : 0;
    discounts.push(
      discountEligible ? { name: item.combo_discount_name!, amount: discountAmount } : null,
    );

    return {
      order_id: order.id,
      menu_item_id: item.id,
      item_name: item.name,
      unit_price: item.price - discountAmount + optionsTotal,
      quantity: line.quantity,
      serve_timing: item.allows_timing_choice ? line.serve_timing : 'during',
      category_is_drink: isDrinkItem(item),
    };
  });

  const { data: insertedItems, error: itemsError } = await admin
    .from('order_items')
    .insert(rows)
    .select('id');

  if (itemsError || !insertedItems || insertedItems.length !== rows.length) {
    // 明細のない空の注文が残ると店員の画面を汚すため取り消す
    await admin.from('orders').delete().eq('id', order.id);
    return errorResponse('注文の登録に失敗しました', 500);
  }

  // 選択されたオプションと、適用されたセット割引を、対応する注文明細に
  // 紐づけて記録する(表示用。割引は extra_price を負の値にして表す)
  const optionRows = lines.flatMap((line, index) => {
    const entries = line.option_ids.map((id) => {
      const option = optionById.get(id)!;
      return {
        order_item_id: insertedItems[index].id,
        option_name: option.name,
        extra_price: option.extra_price,
      };
    });
    const discount = discounts[index];
    if (discount) {
      entries.push({
        order_item_id: insertedItems[index].id,
        option_name: discount.name,
        extra_price: -discount.amount,
      });
    }
    return entries;
  });

  if (optionRows.length > 0) {
    const { error: optionInsertError } = await admin
      .from('order_item_options')
      .insert(optionRows);
    if (optionInsertError) {
      await admin.from('orders').delete().eq('id', order.id);
      return errorResponse('注文の登録に失敗しました', 500);
    }
  }

  return jsonResponse({ order_id: order.id, session_id: sessionId });
});

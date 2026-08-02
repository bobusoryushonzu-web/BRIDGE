/**
 * get-session (FR-01)
 *
 * QR トークンを検証して席を特定し、未会計セッションがあれば返す。
 * FRONT-system が最初に呼ぶ入口。
 */
import {
  adminClient,
  closeStaleSessions,
  errorResponse,
  findOpenSession,
  handlePreflight,
  jsonResponse,
  readJson,
  resolveTable,
} from '../_shared/utils.ts';

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

  // 会計完了の操作漏れで前の客のセッションが残っている場合に備え、
  // 席を開く前に放置セッションを閉じる(要件 OP-01)。
  await closeStaleSessions(admin);

  const session = await findOpenSession(admin, table.id);

  return jsonResponse({
    table,
    session: session ? { id: session.id, status: session.status } : null,
  });
});

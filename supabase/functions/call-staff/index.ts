/**
 * call-staff (FR-06 / FR-07 / FR-08)
 *
 * 呼び鈴・食後提供の合図・会計依頼を受け付ける。
 * 同じ種類の未対応の呼び出しが既にある場合は新規作成せず既存を返す。
 * 客がボタンを連打しても店員の画面が同じ依頼で埋まらないようにするため。
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

type CallType = 'bell' | 'serve_after' | 'checkout';

const VALID_TYPES: readonly CallType[] = ['bell', 'serve_after', 'checkout'];

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse('POST のみ受け付けます', 405);
  }

  const body = await readJson(req);
  if (!body) return errorResponse('リクエストの形式が不正です', 400);

  const type = body.type as CallType;
  if (!VALID_TYPES.includes(type)) {
    return errorResponse('呼び出しの種類が不正です', 400);
  }

  const admin = adminClient();

  const table = await resolveTable(admin, body.qr_token);
  if (!table) {
    return errorResponse('この QR コードは無効です。店員にお知らせください', 404);
  }

  await closeStaleSessions(admin);

  let session = await findOpenSession(admin, table.id);

  // 呼び鈴は注文前でも押せる必要がある(着席直後の用件)。その場合は
  // セッションを開始する。食後提供と会計は、対象の注文が無ければ成立しない。
  if (!session) {
    if (type !== 'bell') {
      return errorResponse('まだご注文がありません', 409);
    }
    const { data: sessionId, error } = await admin.rpc('fn_get_or_create_session', {
      p_table_id: table.id,
    });
    if (error || !sessionId) {
      return errorResponse('席の利用開始に失敗しました', 500);
    }
    session = { id: sessionId as string, status: 'active', opened_at: '' };
  }

  // 連打対策: 同種の未対応呼び出しがあればそれを返す
  const { data: existing } = await admin
    .from('staff_calls')
    .select('id')
    .eq('session_id', session.id)
    .eq('type', type)
    .eq('status', 'open')
    .maybeSingle();

  if (existing) {
    return jsonResponse({ call_id: existing.id, type });
  }

  const { data: call, error: callError } = await admin
    .from('staff_calls')
    .insert({ session_id: session.id, type })
    .select('id')
    .single();

  if (callError || !call) {
    return errorResponse('呼び出しに失敗しました。お手数ですが店員にお声がけください', 500);
  }

  // 会計依頼はセッションの状態にも反映し、店員の一覧で会計待ちが分かるようにする
  if (type === 'checkout') {
    await admin
      .from('sessions')
      .update({ status: 'checkout_requested' })
      .eq('id', session.id)
      .eq('status', 'active');
  }

  return jsonResponse({ call_id: call.id, type });
});

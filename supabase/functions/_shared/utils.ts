/**
 * Edge Functions 共通ユーティリティ
 *
 * FRONT-system(客側)は認証を持たない。QR トークンを唯一の資格情報として
 * ここで検証し、以降の処理は service_role で行う。クライアントから渡された値は
 * 席の特定にのみ使い、金額や商品名は必ずデータベース側から取り直す。
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/** CORS プリフライトへの応答。各関数の冒頭で使う */
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

/** service_role クライアント。RLS を迂回できるため Edge Functions 内でのみ使う */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface ResolvedTable {
  id: string;
  table_number: string;
}

/**
 * QR トークンから席を特定する。
 * 無効なトークン・停止中の席は null を返し、呼び出し側で 404 にする。
 */
export async function resolveTable(
  admin: SupabaseClient,
  qrToken: unknown,
): Promise<ResolvedTable | null> {
  if (typeof qrToken !== 'string' || qrToken.length < 8 || qrToken.length > 128) {
    return null;
  }
  const { data, error } = await admin
    .from('tables')
    .select('id, table_number')
    .eq('qr_token', qrToken)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  return data as ResolvedTable;
}

/**
 * 放置されたセッションを閉じる(要件 OP-01)。
 * 会計完了操作の忘れによって次の客の注文が前の客の伝票に混ざるのを防ぐ。
 */
export async function closeStaleSessions(admin: SupabaseClient): Promise<void> {
  const hours = Number(Deno.env.get('STALE_SESSION_HOURS') ?? '6');
  await admin.rpc('fn_auto_close_stale_sessions', {
    p_hours: Number.isFinite(hours) && hours > 0 ? Math.floor(hours) : 6,
  });
}

/** 未会計(active / checkout_requested)のセッションを取得する */
export async function findOpenSession(
  admin: SupabaseClient,
  tableId: string,
): Promise<{ id: string; status: string; opened_at: string } | null> {
  const { data } = await admin
    .from('sessions')
    .select('id, status, opened_at')
    .eq('table_id', tableId)
    .neq('status', 'closed')
    .maybeSingle();
  return data ?? null;
}

/** リクエストボディを JSON として読む。壊れていれば null */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を .env に設定してください',
  );
}

// FRONT-system は客が使うアプリで、ログインの概念がない。
// 認証セッションを保存する必要がないため無効にしておく。
//
// anon キーはブラウザに露出する前提の設計。このキーで読めるのは
// メニュー(商品・カテゴリ)だけで、注文・伝票・呼び出しの各テーブルには
// 行レベルセキュリティによって一切到達できない。
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

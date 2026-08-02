import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を .env に設定してください',
  );
}

// anon キーはブラウザに露出する前提の設計。実際の保護は
// データベース側の行レベルセキュリティ(RLS)が担う。
export const supabase = createClient(url, anonKey);

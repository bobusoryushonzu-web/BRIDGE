-- BRIDGE 開発用初期データ
-- ローカル開発 (supabase db reset) でのみ使用する。本番には投入しない。

-- pgcrypto の導入先(public / extensions)に依存しないようにする
set search_path = public, extensions;

-- ============================================================
-- 開発用の店員アカウント
--   メールアドレス: staff@bridge.local
--   パスワード:     bridge1234
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated',
  'staff@bridge.local',
  crypt('bridge1234', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  '', '', '', ''
) on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"staff@bridge.local"}',
  'email', now(), now(), now()
) on conflict do nothing;

-- auth.users に登録しただけでは BACK-system の権限は付かない。
-- staff_users への登録が権限の実体。
insert into public.staff_users (id, display_name, role) values
  ('11111111-1111-1111-1111-111111111111', '開発用スタッフ', 'admin')
on conflict (id) do nothing;

-- ============================================================
-- 席(10席)
-- ============================================================
-- qr_token は自動生成されるが、開発中は URL を固定したいので明示する。
insert into public.tables (table_number, qr_token, sort_order) values
  ('1',  'dev-token-table-01', 1),
  ('2',  'dev-token-table-02', 2),
  ('3',  'dev-token-table-03', 3),
  ('4',  'dev-token-table-04', 4),
  ('5',  'dev-token-table-05', 5),
  ('6',  'dev-token-table-06', 6),
  ('7',  'dev-token-table-07', 7),
  ('8',  'dev-token-table-08', 8),
  ('9',  'dev-token-table-09', 9),
  ('10', 'dev-token-table-10', 10)
on conflict (table_number) do nothing;

-- ============================================================
-- カテゴリ(種類)
-- ============================================================
insert into public.categories (id, name, sort_order) values
  ('22222222-0000-0000-0000-000000000001', '定食',       1),
  ('22222222-0000-0000-0000-000000000002', 'その他主食', 2),
  ('22222222-0000-0000-0000-000000000003', 'デザート',   3),
  ('22222222-0000-0000-0000-000000000004', 'ドリンク',   4)
on conflict (id) do nothing;

-- ============================================================
-- 商品
-- ============================================================
-- allows_timing_choice = true の商品のみ、客が注文時に「食中/食後」を選べる。
insert into public.menu_items
  (category_id, name, price, description, allows_timing_choice, sort_order) values
  ('22222222-0000-0000-0000-000000000001', 'ハンバーグ定食',       1480, 'デミグラスソース・ライス・スープ付き', false, 1),
  ('22222222-0000-0000-0000-000000000001', '牛ハラミ定食',         1980, 'ライス・スープ付き', false, 2),
  ('22222222-0000-0000-0000-000000000001', '本日の魚定食',         1680, 'ライス・スープ付き', false, 3),
  ('22222222-0000-0000-0000-000000000002', 'カルボナーラ',         1280, '', false, 1),
  ('22222222-0000-0000-0000-000000000002', 'マルゲリータピザ',     1380, '', false, 2),
  ('22222222-0000-0000-0000-000000000002', 'シーザーサラダ',       780,  'ロメインレタスと自家製ドレッシング', false, 3),
  ('22222222-0000-0000-0000-000000000003', 'ティラミス',           580,  '', true, 1),
  ('22222222-0000-0000-0000-000000000003', 'バニラアイス',         430,  '', true, 2),
  ('22222222-0000-0000-0000-000000000003', 'ガトーショコラ',       620,  '', true, 3),
  ('22222222-0000-0000-0000-000000000004', 'コーヒー',             450,  'ホット / アイス', true, 1),
  ('22222222-0000-0000-0000-000000000004', '紅茶',                 450,  '', true, 2),
  ('22222222-0000-0000-0000-000000000004', 'オレンジジュース',     400,  '', true, 3),
  ('22222222-0000-0000-0000-000000000004', '生ビール',             600,  '', false, 4)
on conflict do nothing;

-- ============================================================
-- ドリンクのセット割引デモ(他の商品と一緒に注文すると割引になる例)
-- ============================================================
update public.menu_items
   set combo_discount_name = 'セット割引', combo_discount_amount = 100
 where name in ('コーヒー', '紅茶');

-- BRIDGE 初期スキーマ
-- 要件定義書 docs/REQUIREMENTS.md 4章に対応する

-- ============================================================
-- 席 (tables)
-- ============================================================
-- QR コードは席ごとに固定でローテーションしない(要件による)。
-- 席番号をそのまま URL に使うと他席になりすませるため、
-- 推測不能なランダム値 qr_token を鍵として用いる。
--
-- トークンは gen_random_uuid() 2つを連結した 64 桁の16進文字列。
-- PostgreSQL 本体の機能だけで生成でき、拡張機能の導入場所に依存しない。
create table public.tables (
  id           uuid primary key default gen_random_uuid(),
  table_number text        not null unique,
  qr_token     text        not null unique
                 default replace(gen_random_uuid()::text, '-', '')
                      || replace(gen_random_uuid()::text, '-', ''),
  sort_order   int         not null default 0,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now()
);

comment on column public.tables.qr_token is 'QRコードに埋め込む固定トークン。席の識別と認可を兼ねる';

-- ============================================================
-- カテゴリ (categories)
-- ============================================================
create table public.categories (
  id                   uuid primary key default gen_random_uuid(),
  name                 text        not null,
  -- デザート・ドリンクなど、客が「食中/食後」を選べるカテゴリで true
  allows_timing_choice boolean     not null default false,
  sort_order           int         not null default 0,
  is_deleted           boolean     not null default false,
  created_at           timestamptz not null default now()
);

comment on column public.categories.allows_timing_choice is '客が提供タイミング(食中/食後)を選択できるカテゴリか';

-- ============================================================
-- 商品 (menu_items)
-- ============================================================
-- 削除は is_deleted による論理削除とする。物理削除すると
-- その商品を含む過去の注文明細が参照先を失い、伝票を再表示できなくなるため。
create table public.menu_items (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid        not null references public.categories(id) on delete restrict,
  name         text        not null,
  price        int         not null check (price >= 0),
  description  text        not null default '',
  is_available boolean     not null default true,   -- 品切れ切替
  is_deleted   boolean     not null default false,  -- 論理削除
  sort_order   int         not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.menu_items.is_available is '品切れ切替。削除ではなく一時的に注文不可にする';
comment on column public.menu_items.is_deleted   is '論理削除。過去の伝票を壊さずメニューから外す';

create index menu_items_category_idx on public.menu_items (category_id)
  where is_deleted = false;

-- ============================================================
-- 会計セッション (sessions)
-- ============================================================
-- 1組の来店から会計完了までの単位。複数回の注文を束ねる。
create table public.sessions (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid        not null references public.tables(id) on delete restrict,
  status     text        not null default 'active'
               check (status in ('active', 'checkout_requested', 'closed')),
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz
);

-- 1つの席に未会計のセッションは同時に1つだけ。
-- 会計完了操作を忘れたまま次の客の注文が別セッションとして立つ事故を
-- データベース側で防ぐ。
create unique index sessions_one_open_per_table
  on public.sessions (table_id)
  where status <> 'closed';

create index sessions_open_idx on public.sessions (status)
  where status <> 'closed';

-- ============================================================
-- 注文 (orders)
-- ============================================================
-- 1回の送信操作が1レコード。追加注文は同じセッションに積み上がる。
create table public.orders (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid        not null references public.sessions(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index orders_session_idx on public.orders (session_id);

-- ============================================================
-- 注文明細 (order_items)
-- ============================================================
-- 提供状況は注文単位ではなく商品1点ごとに持つ。1回の注文に複数の商品が
-- 含まれる場合、料理は同時に出来上がらないため、注文単位では
-- 「5品中4品を出した」状態を表現できないから。
create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid        not null references public.orders(id) on delete cascade,
  -- 商品が論理削除されても明細は残る。表示には item_name / unit_price を使う。
  menu_item_id uuid        references public.menu_items(id) on delete set null,
  item_name    text        not null,  -- 注文時点の商品名のコピー
  unit_price   int         not null check (unit_price >= 0), -- 注文時点の単価のコピー
  quantity     int         not null check (quantity > 0),
  serve_timing text        not null default 'during'
                 check (serve_timing in ('during', 'after')),
  status       text        not null default 'pending'
                 check (status in ('pending', 'served')),
  served_at    timestamptz,
  created_at   timestamptz not null default now()
);

comment on column public.order_items.item_name    is '注文時点の商品名。メニュー変更後も伝票を再現するため';
comment on column public.order_items.unit_price   is '注文時点の単価。メニュー変更後も金額を再現するため';
comment on column public.order_items.serve_timing is 'during=食中 / after=食後';

create index order_items_order_idx   on public.order_items (order_id);
create index order_items_pending_idx on public.order_items (status)
  where status = 'pending';

-- ============================================================
-- 呼び出し (staff_calls)
-- ============================================================
-- 呼び鈴・食後提供の合図・会計依頼を1テーブルで扱う。
-- 店員画面に未対応の依頼が種類を問わず時系列で並ぶため取りこぼしがない。
create table public.staff_calls (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid        not null references public.sessions(id) on delete cascade,
  type       text        not null check (type in ('bell', 'serve_after', 'checkout')),
  status     text        not null default 'open' check (status in ('open', 'handled')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid        references auth.users(id) on delete set null
);

comment on column public.staff_calls.type is 'bell=呼び鈴 / serve_after=食後提供の合図 / checkout=会計依頼';

create index staff_calls_open_idx on public.staff_calls (status, created_at)
  where status = 'open';

-- ============================================================
-- 店員 (staff_users)
-- ============================================================
create table public.staff_users (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text        not null default '',
  role         text        not null default 'staff' check (role in ('admin', 'staff')),
  created_at   timestamptz not null default now()
);

comment on table public.staff_users is 'BACK-system にログインできる店員。auth.users に登録しただけでは権限は付かない';

-- ============================================================
-- updated_at 自動更新
-- ============================================================
create or replace function public.fn_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger menu_items_touch_updated_at
  before update on public.menu_items
  for each row execute function public.fn_touch_updated_at();

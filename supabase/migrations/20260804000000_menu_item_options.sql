-- 商品オプション(追加料金でご飯大盛・麺ダブルなどを付けられる機能)
--
-- 設計方針:
--   - オプションは商品ごとに持つ(ドリンク以外の一部商品、という運用に合わせる)
--   - 客が選んだオプションは注文時点の名前・追加料金をコピー保存する
--     (menu_items.price や item_name と同じく、後からオプションの価格を
--     変えても過去の伝票が変わらないようにするため)
--   - order_items.unit_price には「基本価格 + 選んだオプションの追加料金」を
--     合算して保存する。こうすることで、伝票合計・売上集計など既存の
--     unit_price × quantity を使う集計処理を一切変更せずに済む。
--     order_item_options はどのオプションを選んだかの明細表示専用。

-- ============================================================
-- 商品オプションの定義 (BACK-system で商品ごとに管理する)
-- ============================================================
create table public.menu_item_options (
  id           uuid primary key default gen_random_uuid(),
  menu_item_id uuid        not null references public.menu_items(id) on delete cascade,
  name         text        not null,                 -- 例: 'ご飯大盛'
  extra_price  int         not null check (extra_price >= 0), -- 例: 50
  is_deleted   boolean     not null default false,
  sort_order   int         not null default 0,
  created_at   timestamptz not null default now()
);

comment on table public.menu_item_options is
  '商品に付けられる追加料金オプション(例: ご飯大盛+50円、麺ダブル+100円)';

create index menu_item_options_item_idx on public.menu_item_options (menu_item_id)
  where is_deleted = false;

-- ============================================================
-- 注文明細に紐づく、選択されたオプションの記録
-- ============================================================
create table public.order_item_options (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid        not null references public.order_items(id) on delete cascade,
  option_name   text        not null,               -- 注文時点のオプション名のコピー
  extra_price   int         not null,                -- 注文時点の追加料金のコピー(1点あたり)
  created_at    timestamptz not null default now()
);

comment on column public.order_item_options.option_name is '注文時点のオプション名。後からオプション名を変更・削除しても伝票を再現できるようにする';
comment on column public.order_item_options.extra_price is '注文時点の追加料金(1点あたり)。order_items.unit_price には基本価格と合算済みの値が入る';

create index order_item_options_item_idx on public.order_item_options (order_item_id);

-- ============================================================
-- RLS
-- ============================================================
alter table public.menu_item_options  enable row level security;
alter table public.order_item_options enable row level security;

revoke all on public.order_item_options from anon;

-- 客は削除されていないオプションを閲覧できる(注文時の選択肢として必要)
create policy menu_item_options_select_anon on public.menu_item_options
  for select to anon
  using (
    is_deleted = false
    and exists (
      select 1 from public.menu_items m
       where m.id = menu_item_options.menu_item_id and m.is_deleted = false
    )
  );

create policy menu_item_options_select_staff on public.menu_item_options
  for select to authenticated using (public.fn_is_staff());

create policy menu_item_options_write_admin on public.menu_item_options
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy order_item_options_all_staff on public.order_item_options
  for all to authenticated
  using (public.fn_is_staff()) with check (public.fn_is_staff());

-- リアルタイム配信は不要(注文作成時に order_items 側の配信で店員画面は更新される)

-- BRIDGE 行レベルセキュリティ(RLS)・補助関数・リアルタイム配信設定
--
-- アクセス方針(docs/REQUIREMENTS.md 5.1):
--   客 (anon)          … 認証なし。メニューの閲覧のみ許可し、注文・伝票・呼び出しの
--                        各テーブルには一切触れられない。書き込みは Edge Functions 経由。
--   店員 (authenticated) … staff_users に登録されている場合のみ全データを操作できる。

-- ============================================================
-- 権限判定の補助関数
-- ============================================================
-- security definer にすることで staff_users 自身の RLS を経由せず判定でき、
-- ポリシー評価が再帰しない。
create or replace function public.fn_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_users where id = auth.uid());
$$;

create or replace function public.fn_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_users where id = auth.uid() and role = 'admin'
  );
$$;

-- ============================================================
-- RLS 有効化
-- ============================================================
alter table public.tables       enable row level security;
alter table public.categories   enable row level security;
alter table public.menu_items   enable row level security;
alter table public.sessions     enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.staff_calls  enable row level security;
alter table public.staff_users  enable row level security;

-- RLS に加えて、客ロールからは権限自体を剥奪しておく(多層防御)。
-- メニュー2テーブルのみ SELECT を残す。
revoke all on public.tables      from anon;
revoke all on public.sessions    from anon;
revoke all on public.orders      from anon;
revoke all on public.order_items from anon;
revoke all on public.staff_calls from anon;
revoke all on public.staff_users from anon;

-- ============================================================
-- メニュー(客も閲覧できる唯一のデータ)
-- ============================================================
-- 客には削除済みカテゴリ・商品を見せない。品切れ商品は「選べない状態」で
-- 表示する必要があるため、is_available では絞らずクライアントに渡す。
create policy categories_select_anon on public.categories
  for select to anon
  using (is_deleted = false);

create policy menu_items_select_anon on public.menu_items
  for select to anon
  using (
    is_deleted = false
    and exists (
      select 1 from public.categories c
      where c.id = menu_items.category_id and c.is_deleted = false
    )
  );

-- 店員は削除済みも含めて全件参照できる(管理画面で復元判断を行うため)
create policy categories_select_staff on public.categories
  for select to authenticated using (public.fn_is_staff());

create policy menu_items_select_staff on public.menu_items
  for select to authenticated using (public.fn_is_staff());

-- メニューの編集は admin のみ
create policy categories_write_admin on public.categories
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy menu_items_write_admin on public.menu_items
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ============================================================
-- 席
-- ============================================================
-- qr_token を含むため客には一切開示しない。
create policy tables_select_staff on public.tables
  for select to authenticated using (public.fn_is_staff());

create policy tables_write_admin on public.tables
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ============================================================
-- セッション・注文・明細・呼び出し(店員のみ)
-- ============================================================
create policy sessions_all_staff on public.sessions
  for all to authenticated
  using (public.fn_is_staff()) with check (public.fn_is_staff());

create policy orders_all_staff on public.orders
  for all to authenticated
  using (public.fn_is_staff()) with check (public.fn_is_staff());

create policy order_items_all_staff on public.order_items
  for all to authenticated
  using (public.fn_is_staff()) with check (public.fn_is_staff());

create policy staff_calls_all_staff on public.staff_calls
  for all to authenticated
  using (public.fn_is_staff()) with check (public.fn_is_staff());

-- ============================================================
-- 店員マスタ
-- ============================================================
-- 自分の情報は誰でも読める(ログイン後の表示名取得のため)。
create policy staff_users_select_self on public.staff_users
  for select to authenticated using (id = auth.uid());

create policy staff_users_select_staff on public.staff_users
  for select to authenticated using (public.fn_is_staff());

-- 店員の追加・削除は admin のみ
create policy staff_users_write_admin on public.staff_users
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ============================================================
-- セッションの取得または作成(Edge Functions から呼ぶ)
-- ============================================================
-- 同じ席の複数人が同時に注文した場合でもセッションが二重に作られないよう、
-- 部分ユニークインデックスの競合を吸収して1つに収束させる。
create or replace function public.fn_get_or_create_session(p_table_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.sessions
   where table_id = p_table_id and status <> 'closed'
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.sessions (table_id)
  values (p_table_id)
  on conflict do nothing
  returning id into v_id;

  -- 競合で挿入されなかった場合は、相手が作ったセッションを使う
  if v_id is null then
    select id into v_id
      from public.sessions
     where table_id = p_table_id and status <> 'closed'
     limit 1;
  end if;

  return v_id;
end;
$$;

-- ============================================================
-- 放置セッションの自動クローズ(要件 OP-01)
-- ============================================================
-- 店員が会計完了操作を忘れると、次の客の注文が前の客の伝票に混ざる。
-- 最終注文から一定時間が過ぎたセッションを閉じる安全装置。
-- Edge Function から来店時に呼ばれるほか、pg_cron で定期実行してもよい。
create or replace function public.fn_auto_close_stale_sessions(p_hours int default 6)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with stale as (
    update public.sessions s
       set status = 'closed',
           closed_at = now()
     where s.status <> 'closed'
       and coalesce(
             (select max(o.created_at) from public.orders o where o.session_id = s.id),
             s.opened_at
           ) < now() - make_interval(hours => p_hours)
    returning 1
  )
  select count(*) into v_count from stale;
  return v_count;
end;
$$;

-- 上記2関数は Edge Functions(service_role)からのみ呼ぶ。
revoke execute on function public.fn_get_or_create_session(uuid)   from public, anon, authenticated;
revoke execute on function public.fn_auto_close_stale_sessions(int) from public, anon;
grant  execute on function public.fn_get_or_create_session(uuid)   to service_role;
grant  execute on function public.fn_auto_close_stale_sessions(int) to service_role, authenticated;

-- ============================================================
-- 注文照会用のサマリビュー(BACK-system BK-05)
-- ============================================================
-- security_invoker により、閲覧者の権限で下位テーブルの RLS が評価される。
-- ビュー経由で RLS を迂回されることを防ぐ。
create view public.v_session_summary
with (security_invoker = true)
as
select
  s.id                                             as session_id,
  s.table_id,
  t.table_number,
  s.status,
  s.opened_at,
  s.closed_at,
  coalesce(sum(oi.unit_price * oi.quantity), 0)::int as total_amount,
  coalesce(sum(oi.quantity), 0)::int                 as item_count,
  coalesce(sum(oi.quantity) filter (where oi.status = 'pending'), 0)::int as pending_count
from public.sessions s
join public.tables t on t.id = s.table_id
left join public.orders o      on o.session_id = s.id
left join public.order_items oi on oi.order_id = o.id
group by s.id, s.table_id, t.table_number, s.status, s.opened_at, s.closed_at;

-- ============================================================
-- リアルタイム配信(BACK-system への即時通知)
-- ============================================================
-- 更新イベントで変更前の行も受け取れるようにする(提供済み切替の反映用)。
alter table public.order_items  replica identity full;
alter table public.staff_calls  replica identity full;
alter table public.sessions     replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders;
    alter publication supabase_realtime add table public.order_items;
    alter publication supabase_realtime add table public.staff_calls;
    alter publication supabase_realtime add table public.sessions;
  end if;
end
$$;

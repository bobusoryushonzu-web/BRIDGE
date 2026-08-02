-- BRIDGE 通し検証: 来店から会計まで
--
-- FRONT-system(客)の操作と BACK-system(店員)の操作を交互に実行し、
-- 片方の操作がもう片方から正しく見えることを確認する。
-- Edge Functions が行う処理と同じ順序・同じSQLを実行している。
--
-- 期待どおりなら全行 PASS になる。

create temporary table e2e (no int, step text, result text);

create or replace function pg_temp.ok(p_no int, p_step text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into e2e values (p_no, p_step, case when p_ok then 'PASS' else '*** FAIL ***' end);
end $$;

-- 検証で使う値を保持する
create temporary table ctx (k text primary key, v text);

-- 店員役 (authenticated) に切り替えた状態でも検証用の表を読み書きできるようにする
grant all on e2e to public;
grant all on ctx to public;

create or replace function pg_temp.put(p_k text, p_v text) returns void
language sql as $$ insert into ctx values (p_k, p_v)
  on conflict (k) do update set v = excluded.v; $$;
create or replace function pg_temp.get(p_k text) returns text
language sql stable as $$ select v from ctx where k = p_k $$;

-- ============================================================
-- 前提: 5番テーブルは未使用の状態から始める
-- ============================================================
do $$
declare v_table uuid;
begin
  select id into v_table from public.tables where table_number = '5';
  update public.sessions set status = 'closed', closed_at = now()
   where table_id = v_table and status <> 'closed';
  perform pg_temp.put('table_id', v_table::text);
  perform pg_temp.ok(1, '5番テーブルが空席である',
    not exists (select 1 from public.sessions
                 where table_id = v_table and status <> 'closed'));
end $$;

-- ============================================================
-- 【客】QRを読み取り、注文を送信する (FR-01 / FR-04)
--   Edge Function place-order の処理に相当
-- ============================================================
do $$
declare
  v_table   uuid := pg_temp.get('table_id')::uuid;
  v_session uuid;
  v_order   uuid;
begin
  -- QRトークンから席を特定 → セッションを取得または作成
  v_session := public.fn_get_or_create_session(v_table);
  perform pg_temp.put('session_id', v_session::text);

  insert into public.orders (session_id) values (v_session) returning id into v_order;

  -- 商品名と価格はメニューから取り直す(クライアントの申告値は使わない)
  insert into public.order_items
    (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing)
  select v_order, id, name, price, 1, 'during'
    from public.menu_items where name = 'ハンバーグステーキ';

  insert into public.order_items
    (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing)
  select v_order, id, name, price, 2, 'after'
    from public.menu_items where name = 'ティラミス';

  perform pg_temp.ok(2, '【客】注文を送信できる',
    (select count(*) from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.session_id = v_session) = 2);
end $$;

-- ============================================================
-- 【店員】提供状況に、食中は「今出す」、食後は「待機」として現れる (BK-06)
-- ============================================================
do $$
declare v_during int; v_after int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  -- 行数ではなく数量の合計で数える。1行に複数個入るため。
  select coalesce(sum(oi.quantity), 0) into v_during
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.session_id = pg_temp.get('session_id')::uuid
     and oi.status = 'pending' and oi.serve_timing = 'during';

  select coalesce(sum(oi.quantity), 0) into v_after
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.session_id = pg_temp.get('session_id')::uuid
     and oi.status = 'pending' and oi.serve_timing = 'after';

  reset role;
  perform pg_temp.ok(3, '【店員】客の注文が即座に見える(食中1・食後2)',
    v_during = 1 and v_after = 2);
end $$;

-- ============================================================
-- 【店員】食中の商品を提供済みにする (BK-07)
-- ============================================================
do $$
declare v_remaining int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  update public.order_items oi
     set status = 'served', served_at = now()
    from public.orders o
   where o.id = oi.order_id
     and o.session_id = pg_temp.get('session_id')::uuid
     and oi.serve_timing = 'during';

  select count(*) into v_remaining
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.session_id = pg_temp.get('session_id')::uuid
     and oi.status = 'pending' and oi.serve_timing = 'during';

  reset role;
  perform pg_temp.ok(4, '【店員】提供済みにすると未提供から消える', v_remaining = 0);
end $$;

-- ============================================================
-- 【客】追加注文する。同じセッションに積み上がる (FR-04)
-- ============================================================
do $$
declare
  v_session uuid := pg_temp.get('session_id')::uuid;
  v_order   uuid;
  v_sessions int;
begin
  -- 2回目でも同じセッションが返ること = 伝票が分かれない
  perform pg_temp.ok(5, '【客】追加注文が同じ伝票に入る',
    public.fn_get_or_create_session(pg_temp.get('table_id')::uuid) = v_session);

  insert into public.orders (session_id) values (v_session) returning id into v_order;
  insert into public.order_items
    (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing)
  select v_order, id, name, price, 1, 'during'
    from public.menu_items where name = '生ビール';

  select count(*) into v_sessions from public.sessions
   where table_id = pg_temp.get('table_id')::uuid and status <> 'closed';
  perform pg_temp.ok(6, '【客】追加注文でセッションが増えない', v_sessions = 1);
end $$;

-- ============================================================
-- 【客】呼び鈴を押す → 【店員】未対応として見える (FR-06 / BK-09)
-- ============================================================
do $$
declare v_open int; v_call uuid;
begin
  insert into public.staff_calls (session_id, type)
  values (pg_temp.get('session_id')::uuid, 'bell')
  returning id into v_call;
  perform pg_temp.put('call_id', v_call::text);

  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  select count(*) into v_open from public.staff_calls
   where session_id = pg_temp.get('session_id')::uuid and status = 'open';
  reset role;

  perform pg_temp.ok(7, '【客→店員】呼び鈴が未対応として届く', v_open = 1);
end $$;

-- ============================================================
-- 【店員】対応済みにすると一覧から消える (BK-09)
-- ============================================================
do $$
declare v_open int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  update public.staff_calls
     set status = 'handled', handled_at = now(),
         handled_by = '11111111-1111-1111-1111-111111111111'
   where id = pg_temp.get('call_id')::uuid;

  select count(*) into v_open from public.staff_calls
   where session_id = pg_temp.get('session_id')::uuid and status = 'open';
  reset role;

  perform pg_temp.ok(8, '【店員】対応済みにすると消える', v_open = 0);
end $$;

-- ============================================================
-- 【客】食後の商品を出してほしいと合図する (FR-07)
--   保留中の食後商品があるときだけ押せるボタン
-- ============================================================
do $$
declare v_has_after boolean; v_items text;
begin
  select exists (
    select 1 from public.order_items oi
     join public.orders o on o.id = oi.order_id
    where o.session_id = pg_temp.get('session_id')::uuid
      and oi.serve_timing = 'after' and oi.status = 'pending'
  ) into v_has_after;
  perform pg_temp.ok(9, '【客】食後商品があるので合図ボタンが出る', v_has_after);

  insert into public.staff_calls (session_id, type)
  values (pg_temp.get('session_id')::uuid, 'serve_after');

  -- 店員側には「何を出すのか」が添えられる (BK-10)
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  select string_agg(oi.item_name || '×' || oi.quantity, '、') into v_items
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.session_id = pg_temp.get('session_id')::uuid
     and oi.serve_timing = 'after' and oi.status = 'pending';
  reset role;

  perform pg_temp.ok(10, '【店員】合図に対象商品名が添えられる', v_items = 'ティラミス×2');
end $$;

-- ============================================================
-- 【客】会計を依頼する (FR-08) → 【店員】席の状態が変わる (BK-11)
-- ============================================================
do $$
declare v_status text; v_total int;
begin
  insert into public.staff_calls (session_id, type)
  values (pg_temp.get('session_id')::uuid, 'checkout');

  update public.sessions set status = 'checkout_requested'
   where id = pg_temp.get('session_id')::uuid and status = 'active';

  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  select status, total_amount into v_status, v_total
    from public.v_session_summary
   where session_id = pg_temp.get('session_id')::uuid;
  reset role;

  -- ハンバーグ1480 + ティラミス580×2 + 生ビール600 = 3240
  perform pg_temp.ok(11, '【客→店員】会計依頼が席の状態に反映される',
    v_status = 'checkout_requested');
  perform pg_temp.ok(12, '【店員】伝票の合計金額が正しい(3,240円)', v_total = 3240);
end $$;

-- ============================================================
-- 【店員】誤注文を伝票から取り消せる
-- ============================================================
do $$
declare v_total int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  delete from public.order_items oi
   using public.orders o
   where o.id = oi.order_id
     and o.session_id = pg_temp.get('session_id')::uuid
     and oi.item_name = '生ビール';

  select total_amount into v_total from public.v_session_summary
   where session_id = pg_temp.get('session_id')::uuid;
  reset role;

  perform pg_temp.ok(13, '【店員】誤注文を取り消すと合計が減る(2,640円)', v_total = 2640);
end $$;

-- ============================================================
-- 【店員】会計を完了する (BK-12)
--   セッションを閉じ、残った未対応の呼び出しもまとめて閉じる
-- ============================================================
do $$
declare v_status text; v_open int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  update public.sessions
     set status = 'closed', closed_at = now()
   where id = pg_temp.get('session_id')::uuid;

  update public.staff_calls
     set status = 'handled', handled_at = now()
   where session_id = pg_temp.get('session_id')::uuid and status = 'open';

  select status into v_status from public.sessions
   where id = pg_temp.get('session_id')::uuid;
  select count(*) into v_open from public.staff_calls
   where session_id = pg_temp.get('session_id')::uuid and status = 'open';
  reset role;

  perform pg_temp.ok(14, '【店員】会計完了で伝票が閉じる', v_status = 'closed');
  perform pg_temp.ok(15, '【店員】残った呼び出しもまとめて閉じる', v_open = 0);
end $$;

-- ============================================================
-- 次の客を受け入れられる。前の客の伝票は混ざらない
-- ============================================================
do $$
declare v_new uuid; v_total int;
begin
  v_new := public.fn_get_or_create_session(pg_temp.get('table_id')::uuid);
  perform pg_temp.ok(16, '次の客に新しい伝票が用意される',
    v_new is not null and v_new <> pg_temp.get('session_id')::uuid);

  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  select total_amount into v_total from public.v_session_summary
   where session_id = v_new;
  reset role;

  perform pg_temp.ok(17, '次の客の伝票は0円から始まる', v_total = 0);
end $$;

-- ============================================================
-- 会計済みの伝票は金額が保たれている(記録として残る)
-- ============================================================
do $$
declare v_total int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  select total_amount into v_total from public.v_session_summary
   where session_id = pg_temp.get('session_id')::uuid;
  reset role;
  perform pg_temp.ok(18, '会計済みの伝票が記録として残る', v_total = 2640);
end $$;

select no, step, result from e2e order by no;
select count(*) filter (where result = 'PASS') as pass,
       count(*) filter (where result <> 'PASS') as fail
  from e2e;

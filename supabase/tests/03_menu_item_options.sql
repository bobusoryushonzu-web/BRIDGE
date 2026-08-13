-- BRIDGE 商品オプションの検証
--
-- BACK-system での追加・編集(店員操作)と、place-order Edge Function が
-- 行う処理(客の注文)を再現し、オプションが正しく機能するか確認する。
--
-- 期待どおりなら全行 PASS になる。

create temporary table opt_results (no int, step text, result text);

create or replace function pg_temp.ok(p_no int, p_step text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into opt_results values (p_no, p_step, case when p_ok then 'PASS' else '*** FAIL ***' end);
end $$;

-- ============================================================
-- 準備: 商品とオプションを1つずつ用意する
-- ============================================================
do $$
declare
  v_category uuid;
  v_item     uuid;
  v_option1  uuid;
  v_option2  uuid;
begin
  select id into v_category from public.categories where name = '定食';

  insert into public.menu_items (category_id, name, price, allows_timing_choice)
  values (v_category, 'テスト用ハンバーグ定食', 1000, false)
  returning id into v_item;

  -- 店員(authenticated)としてオプションを追加する
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  insert into public.menu_item_options (menu_item_id, name, extra_price, sort_order)
  values (v_item, 'ごはん大盛', 50, 1)
  returning id into v_option1;

  insert into public.menu_item_options (menu_item_id, name, extra_price, sort_order)
  values (v_item, '味噌汁変更', 30, 2)
  returning id into v_option2;

  reset role;

  create temporary table opt_ctx (k text primary key, v text);
  insert into opt_ctx values
    ('item', v_item::text),
    ('option1', v_option1::text),
    ('option2', v_option2::text);

  perform pg_temp.ok(1, '店員がオプションを追加できる',
    (select count(*) from public.menu_item_options where menu_item_id = v_item) = 2);
end $$;

-- ============================================================
-- 客はオプションを閲覧できる(注文画面での選択肢として必要)
-- ============================================================
do $$
declare v_item uuid; v_count int;
begin
  select v::uuid into v_item from opt_ctx where k = 'item';
  set local role anon;
  select count(*) into v_count from public.menu_item_options where menu_item_id = v_item;
  reset role;
  perform pg_temp.ok(2, '客がオプションを閲覧できる', v_count = 2);
end $$;

-- ============================================================
-- 【客】オプションを選んで注文する(place-order Edge Function 相当)
--   unit_price には基本価格 + 選択したオプションの合計が入る
-- ============================================================
do $$
declare
  v_table   uuid;
  v_item    uuid;
  v_option1 uuid;
  v_option2 uuid;
  v_session uuid;
  v_order   uuid;
  v_order_item uuid;
begin
  select id into v_table from public.tables where table_number = '1';
  select v::uuid into v_item    from opt_ctx where k = 'item';
  select v::uuid into v_option1 from opt_ctx where k = 'option1';
  select v::uuid into v_option2 from opt_ctx where k = 'option2';

  v_session := public.fn_get_or_create_session(v_table);
  insert into opt_ctx values ('session', v_session::text) on conflict (k) do update set v = excluded.v;

  insert into public.orders (session_id) values (v_session) returning id into v_order;

  -- unit_price = 1000(本体) + 50(ごはん大盛) + 30(味噌汁変更) = 1080
  insert into public.order_items
    (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing)
  values (v_order, v_item, 'テスト用ハンバーグ定食', 1080, 2, 'during')
  returning id into v_order_item;

  insert into public.order_item_options (order_item_id, option_name, extra_price)
  values
    (v_order_item, 'ごはん大盛', 50),
    (v_order_item, '味噌汁変更', 30);

  insert into opt_ctx values ('order_item', v_order_item::text) on conflict (k) do update set v = excluded.v;

  perform pg_temp.ok(3, 'オプション込みの単価で明細が作られる',
    (select unit_price from public.order_items where id = v_order_item) = 1080);
end $$;

-- ============================================================
-- 【店員】伝票合計にオプション代が正しく反映される
--   (数量2 × 1080円 = 2160円。既存の集計クエリを一切変更していない)
-- ============================================================
do $$
declare v_session uuid; v_total int;
begin
  select v::uuid into v_session from opt_ctx where k = 'session';

  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  select total_amount into v_total
    from public.v_session_summary where session_id = v_session;
  reset role;

  perform pg_temp.ok(4, '伝票合計にオプション代が反映される(2,160円)', v_total = 2160);
end $$;

-- ============================================================
-- 【店員】選んだオプションの内訳を明細ごとに確認できる
-- ============================================================
do $$
declare v_order_item uuid; v_count int; v_sum int;
begin
  select v::uuid into v_order_item from opt_ctx where k = 'order_item';

  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  select count(*), coalesce(sum(extra_price), 0) into v_count, v_sum
    from public.order_item_options where order_item_id = v_order_item;
  reset role;

  perform pg_temp.ok(5, '選択したオプションの内訳が2件・80円ぶん記録される',
    v_count = 2 and v_sum = 80);
end $$;

-- ============================================================
-- 客は他人の注文のオプション内訳を読めない
-- ============================================================
do $$
declare v_count int;
begin
  set local role anon;
  select count(*) into v_count from public.order_item_options;
  reset role;
  perform pg_temp.ok(6, '客がオプション内訳を読めない', false);
exception when insufficient_privilege then
  reset role;
  perform pg_temp.ok(6, '客がオプション内訳を読めない', true);
when others then
  reset role;
  perform pg_temp.ok(6, '客がオプション内訳を読めない', false);
end $$;

-- ============================================================
-- オプションを論理削除しても、過去の注文の内訳(スナップショット)は残る
-- ============================================================
do $$
declare v_option1 uuid; v_order_item uuid; v_name text;
begin
  select v::uuid into v_option1 from opt_ctx where k = 'option1';
  select v::uuid into v_order_item from opt_ctx where k = 'order_item';

  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  update public.menu_item_options set is_deleted = true where id = v_option1;

  select option_name into v_name
    from public.order_item_options
   where order_item_id = v_order_item and option_name = 'ごはん大盛';

  reset role;
  perform pg_temp.ok(7, 'オプション削除後も過去の注文内訳が残る', v_name = 'ごはん大盛');
end $$;

-- ============================================================
-- 追加料金の負の値は弾く
-- ============================================================
do $$
declare v_item uuid;
begin
  select v::uuid into v_item from opt_ctx where k = 'item';
  insert into public.menu_item_options (menu_item_id, name, extra_price)
  values (v_item, '不正なオプション', -10);
  perform pg_temp.ok(8, '負の追加料金を弾く', false);
exception when check_violation then
  perform pg_temp.ok(8, '負の追加料金を弾く', true);
end $$;

select no, step, result from opt_results order by no;
select count(*) filter (where result = 'PASS') as pass,
       count(*) filter (where result <> 'PASS') as fail
  from opt_results;

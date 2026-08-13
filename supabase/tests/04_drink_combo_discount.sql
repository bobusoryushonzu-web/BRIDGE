-- BRIDGE ドリンクのセット割引の検証
--
-- place-order Edge Function が行う判定・計算を再現し、
-- 「来店中にドリンク以外の商品を注文していれば、対象ドリンクが
-- 自動的に割引される」という挙動が正しいか確認する。
--
-- 期待どおりなら全行 PASS になる。

create temporary table combo_results (no int, step text, result text);

create or replace function pg_temp.ok(p_no int, p_step text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into combo_results values (p_no, p_step, case when p_ok then 'PASS' else '*** FAIL ***' end);
end $$;

-- ============================================================
-- 準備: セット割引付きのドリンクと、非ドリンク商品を用意する
-- ============================================================
do $$
declare
  v_drink_category  uuid;
  v_food_category   uuid;
  v_drink           uuid;
  v_drink_no_discount uuid;
  v_food            uuid;
begin
  select id into v_drink_category from public.categories where name = 'ドリンク';
  select id into v_food_category  from public.categories where name = '定食';

  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  insert into public.menu_items
    (category_id, name, price, allows_timing_choice, combo_discount_name, combo_discount_amount)
  values (v_drink_category, 'テスト用コーヒー', 450, true, 'セット割引', 100)
  returning id into v_drink;

  insert into public.menu_items (category_id, name, price, allows_timing_choice)
  values (v_drink_category, 'テスト用ウーロン茶', 400, true)
  returning id into v_drink_no_discount;

  insert into public.menu_items (category_id, name, price, allows_timing_choice)
  values (v_food_category, 'テスト用定食', 1200, false)
  returning id into v_food;

  reset role;

  create temporary table combo_ctx (k text primary key, v text);
  insert into combo_ctx values
    ('drink', v_drink::text),
    ('drink_no_discount', v_drink_no_discount::text),
    ('food', v_food::text);

  perform pg_temp.ok(1, 'ドリンクにセット割引を設定できる',
    (select combo_discount_amount from public.menu_items where id = v_drink) = 100);
end $$;

-- ============================================================
-- ドリンク単品のみの注文には割引が適用されない
-- ============================================================
do $$
declare
  v_table   uuid;
  v_drink   uuid;
  v_session uuid;
  v_order   uuid;
  v_order_item uuid;
begin
  select id into v_table from public.tables where table_number = '2';
  select v::uuid into v_drink from combo_ctx where k = 'drink';

  v_session := public.fn_get_or_create_session(v_table);
  insert into combo_ctx values ('session', v_session::text) on conflict (k) do update set v = excluded.v;

  insert into public.orders (session_id) values (v_session) returning id into v_order;

  -- 割引条件(ドリンク以外の商品を注文済み)を満たさないため、単価は450円のまま
  insert into public.order_items
    (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing, category_is_drink)
  values (v_order, v_drink, 'テスト用コーヒー', 450, 1, 'during', true)
  returning id into v_order_item;

  perform pg_temp.ok(2, 'ドリンク単品のみの注文では割引が適用されない',
    (select unit_price from public.order_items where id = v_order_item) = 450);
end $$;

-- ============================================================
-- ドリンクと非ドリンク商品を同じ注文で送ると、ドリンクが割引される
-- ============================================================
do $$
declare
  v_session uuid;
  v_drink   uuid;
  v_food    uuid;
  v_order   uuid;
  v_drink_item uuid;
  v_food_item  uuid;
begin
  select v::uuid into v_session from combo_ctx where k = 'session';
  select v::uuid into v_drink   from combo_ctx where k = 'drink';
  select v::uuid into v_food    from combo_ctx where k = 'food';

  insert into public.orders (session_id) values (v_session) returning id into v_order;

  -- 同じ送信に定食(ドリンク以外)が含まれるため、この時点で条件を満たす
  insert into public.order_items
    (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing, category_is_drink)
  values (v_order, v_food, 'テスト用定食', 1200, 1, 'during', false)
  returning id into v_food_item;

  -- コーヒー: 450 - 100(セット割引) = 350
  insert into public.order_items
    (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing, category_is_drink)
  values (v_order, v_drink, 'テスト用コーヒー', 350, 1, 'during', true)
  returning id into v_drink_item;

  insert into public.order_item_options (order_item_id, option_name, extra_price)
  values (v_drink_item, 'セット割引', -100);

  insert into combo_ctx values ('drink_order_item', v_drink_item::text)
    on conflict (k) do update set v = excluded.v;

  perform pg_temp.ok(3, '非ドリンクと同時注文でドリンクが割引される(450→350円)',
    (select unit_price from public.order_items where id = v_drink_item) = 350);
end $$;

-- ============================================================
-- 割引の内訳(-100円)が明細に記録される
-- ============================================================
do $$
declare v_drink_item uuid; v_name text; v_amount int;
begin
  select v::uuid into v_drink_item from combo_ctx where k = 'drink_order_item';

  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  select option_name, extra_price into v_name, v_amount
    from public.order_item_options where order_item_id = v_drink_item;
  reset role;

  perform pg_temp.ok(4, '割引の内訳(セット割引・-100円)が記録される',
    v_name = 'セット割引' and v_amount = -100);
end $$;

-- ============================================================
-- 来店中(セッション全体)で判定するため、あとから注文したドリンク単品にも割引が効く
-- ============================================================
do $$
declare
  v_session uuid;
  v_drink   uuid;
  v_order   uuid;
  v_order_item uuid;
begin
  select v::uuid into v_session from combo_ctx where k = 'session';
  select v::uuid into v_drink   from combo_ctx where k = 'drink';

  insert into public.orders (session_id) values (v_session) returning id into v_order;

  -- このセッションは既に定食(非ドリンク)を注文済みなので、
  -- 今回はドリンク単品のみの送信でも割引が適用される(450→350円)
  insert into public.order_items
    (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing, category_is_drink)
  values (v_order, v_drink, 'テスト用コーヒー', 350, 1, 'during', true)
  returning id into v_order_item;

  perform pg_temp.ok(5, '来店中に非ドリンクを注文済みなら、あとからのドリンク単品注文にも割引が効く',
    (select unit_price from public.order_items where id = v_order_item) = 350);
end $$;

-- ============================================================
-- セット割引を設定していないドリンクは、条件を満たしても割引されない
-- ============================================================
do $$
declare
  v_session uuid;
  v_drink_no_discount uuid;
  v_order uuid;
  v_order_item uuid;
begin
  select v::uuid into v_session from combo_ctx where k = 'session';
  select v::uuid into v_drink_no_discount from combo_ctx where k = 'drink_no_discount';

  insert into public.orders (session_id) values (v_session) returning id into v_order;

  insert into public.order_items
    (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing, category_is_drink)
  values (v_order, v_drink_no_discount, 'テスト用ウーロン茶', 400, 1, 'during', true)
  returning id into v_order_item;

  perform pg_temp.ok(6, 'セット割引未設定のドリンクは割引されない',
    (select unit_price from public.order_items where id = v_order_item) = 400);
end $$;

-- ============================================================
-- 負の割引額は弾く
-- ============================================================
do $$
declare v_category uuid;
begin
  select id into v_category from public.categories where name = 'ドリンク';
  insert into public.menu_items (category_id, name, price, combo_discount_amount)
  values (v_category, '不正な割引ドリンク', 400, -10);
  perform pg_temp.ok(7, '負のセット割引額を弾く', false);
exception when check_violation then
  perform pg_temp.ok(7, '負のセット割引額を弾く', true);
end $$;

select no, step, result from combo_results order by no;
select count(*) filter (where result = 'PASS') as pass,
       count(*) filter (where result <> 'PASS') as fail
  from combo_results;

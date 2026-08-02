-- BRIDGE セキュリティ・整合性の検証
-- 期待どおりなら全行 PASS になる。

create temporary table results (no int, name text, result text);

-- 便利関数: 期待どおりか記録する
create or replace function pg_temp.check(p_no int, p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into results values (p_no, p_name, case when p_ok then 'PASS' else '*** FAIL ***' end);
end $$;

-- ============================================================
-- T1: 客(anon)はメニューを読める
-- ============================================================
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.menu_items;
  reset role;
  perform pg_temp.check(1, '客がメニューを読める', n = 14);
exception when others then
  reset role;
  perform pg_temp.check(1, '客がメニューを読める', false);
end $$;

-- ============================================================
-- T2: 客は注文明細を読めない(他席の伝票を覗けない)
-- ============================================================
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.order_items;
  reset role;
  perform pg_temp.check(2, '客が注文明細を読めない', false); -- 読めてしまったら失敗
exception when insufficient_privilege then
  reset role;
  perform pg_temp.check(2, '客が注文明細を読めない', true);
when others then
  reset role;
  perform pg_temp.check(2, '客が注文明細を読めない', false);
end $$;

-- ============================================================
-- T3: 客は席テーブル(QRトークンを含む)を読めない
-- ============================================================
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.tables;
  reset role;
  perform pg_temp.check(3, '客がQRトークンを読めない', false);
exception when insufficient_privilege then
  reset role;
  perform pg_temp.check(3, '客がQRトークンを読めない', true);
when others then
  reset role;
  perform pg_temp.check(3, '客がQRトークンを読めない', false);
end $$;

-- ============================================================
-- T4: 客はセッション・呼び出しも読めない
-- ============================================================
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.staff_calls;
  reset role;
  perform pg_temp.check(4, '客が呼び出しを読めない', false);
exception when insufficient_privilege then
  reset role;
  perform pg_temp.check(4, '客が呼び出しを読めない', true);
when others then
  reset role;
  perform pg_temp.check(4, '客が呼び出しを読めない', false);
end $$;

-- ============================================================
-- 検証用データを投入(service_role 相当 = 所有者権限で実行)
-- ============================================================
do $$
declare
  v_table_id uuid;
  v_session  uuid;
  v_order    uuid;
begin
  select id into v_table_id from public.tables where table_number = '1';

  -- セッションの取得または作成
  v_session := public.fn_get_or_create_session(v_table_id);
  -- 2回目は同じセッションが返るはず
  perform pg_temp.check(5, 'セッションが重複生成されない',
    v_session = public.fn_get_or_create_session(v_table_id));

  insert into public.orders (session_id) values (v_session) returning id into v_order;

  insert into public.order_items (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing)
  select v_order, id, name, price, 2, 'during' from public.menu_items where name = 'ハンバーグステーキ';

  insert into public.order_items (order_id, menu_item_id, item_name, unit_price, quantity, serve_timing)
  select v_order, id, name, price, 1, 'after' from public.menu_items where name = 'ティラミス';
end $$;

-- ============================================================
-- T6: 同じ席に未会計セッションを2つ作れない
-- ============================================================
do $$
declare v_table_id uuid;
begin
  select id into v_table_id from public.tables where table_number = '1';
  insert into public.sessions (table_id) values (v_table_id);
  perform pg_temp.check(6, '1席に未会計セッションは1つだけ', false);
exception when unique_violation then
  perform pg_temp.check(6, '1席に未会計セッションは1つだけ', true);
end $$;

-- ============================================================
-- T7: 店員(staff_users 登録済み)は注文明細を読める
-- ============================================================
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  select count(*) into n from public.order_items;
  reset role;
  perform pg_temp.check(7, '店員が注文明細を読める', n = 2);
exception when others then
  reset role;
  perform pg_temp.check(7, '店員が注文明細を読める', false);
end $$;

-- ============================================================
-- T8: ログイン済みでも staff_users 未登録なら読めない
-- ============================================================
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
  set local role authenticated;
  select count(*) into n from public.order_items;
  reset role;
  perform pg_temp.check(8, '未登録ユーザーは注文明細を読めない', n = 0);
exception when others then
  reset role;
  perform pg_temp.check(8, '未登録ユーザーは注文明細を読めない', false);
end $$;

-- ============================================================
-- T9: 伝票の合計金額(1480*2 + 580*1 = 3540)
-- ============================================================
do $$
declare v_total int;
begin
  select total_amount into v_total
    from public.v_session_summary
   where table_number = '1' and status <> 'closed';
  perform pg_temp.check(9, '伝票の合計金額が正しい', v_total = 3540);
end $$;

-- ============================================================
-- T10: 未提供数の集計(2品ぶん + 1品ぶん = 3)
-- ============================================================
do $$
declare v_pending int;
begin
  select pending_count into v_pending
    from public.v_session_summary
   where table_number = '1' and status <> 'closed';
  perform pg_temp.check(10, '未提供数の集計が正しい', v_pending = 3);
end $$;

-- ============================================================
-- T11: 商品を論理削除しても過去の伝票が壊れない
-- ============================================================
do $$
declare v_total int; v_name text;
begin
  update public.menu_items set is_deleted = true where name = 'ティラミス';
  select total_amount into v_total
    from public.v_session_summary
   where table_number = '1' and status <> 'closed';
  select item_name into v_name
    from public.order_items where item_name = 'ティラミス' limit 1;
  perform pg_temp.check(11, '商品削除後も伝票が保たれる', v_total = 3540 and v_name = 'ティラミス');
  update public.menu_items set is_deleted = false where name = 'ティラミス';
end $$;

-- ============================================================
-- T12: 価格を変更しても過去の伝票金額が変わらない
-- ============================================================
do $$
declare v_total int;
begin
  update public.menu_items set price = 9999 where name = 'ハンバーグステーキ';
  select total_amount into v_total
    from public.v_session_summary
   where table_number = '1' and status <> 'closed';
  perform pg_temp.check(12, '価格変更後も伝票金額が変わらない', v_total = 3540);
  update public.menu_items set price = 1480 where name = 'ハンバーグステーキ';
end $$;

-- ============================================================
-- T13: 放置セッションの自動クローズ(要件 OP-01)
-- ============================================================
do $$
declare v_closed int; v_status text;
begin
  -- 7時間前の注文に見せかける
  update public.orders set created_at = now() - interval '7 hours';
  select public.fn_auto_close_stale_sessions(6) into v_closed;
  select status into v_status from public.sessions
   where table_id = (select id from public.tables where table_number = '1');
  perform pg_temp.check(13, '放置セッションが自動で閉じる', v_closed = 1 and v_status = 'closed');
end $$;

-- ============================================================
-- T14: 会計後は同じ席で新しいセッションを開ける
-- ============================================================
do $$
declare v_table_id uuid; v_new uuid; v_old uuid;
begin
  select id into v_table_id from public.tables where table_number = '1';
  select id into v_old from public.sessions where table_id = v_table_id limit 1;
  v_new := public.fn_get_or_create_session(v_table_id);
  perform pg_temp.check(14, '会計後に新しいセッションを開ける', v_new is not null and v_new <> v_old);
end $$;

-- ============================================================
-- T15: 数量0や負の価格は登録できない
-- ============================================================
do $$
declare v_order uuid;
begin
  select o.id into v_order from public.orders o limit 1;
  insert into public.order_items (order_id, item_name, unit_price, quantity)
  values (v_order, 'テスト', 100, 0);
  perform pg_temp.check(15, '数量0の明細を弾く', false);
exception when check_violation then
  perform pg_temp.check(15, '数量0の明細を弾く', true);
end $$;

-- ============================================================
-- T16: 不正な提供タイミングを弾く
-- ============================================================
do $$
declare v_order uuid;
begin
  select o.id into v_order from public.orders o limit 1;
  insert into public.order_items (order_id, item_name, unit_price, quantity, serve_timing)
  values (v_order, 'テスト', 100, 1, 'whenever');
  perform pg_temp.check(16, '不正な提供タイミングを弾く', false);
exception when check_violation then
  perform pg_temp.check(16, '不正な提供タイミングを弾く', true);
end $$;

-- ============================================================
-- 結果
-- ============================================================
select no, name, result from results order by no;
select count(*) filter (where result = 'PASS') as pass,
       count(*) filter (where result <> 'PASS') as fail
  from results;

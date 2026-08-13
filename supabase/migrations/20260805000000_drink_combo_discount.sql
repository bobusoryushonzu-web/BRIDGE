-- ドリンクのセット割引
--
-- 「ドリンク以外の商品と同じ来店で注文すると、ドリンクが所定の値段より
-- いくらか安くなる」という運用に対応する。
--
-- 設計方針:
--   - 割引を設定できるのはドリンクカテゴリ(categories.is_drink = true)の
--     商品のみ。名称(例: 'セット割引')と金額を商品ごとに1つ持つ。
--   - 適用範囲は「来店中(セッション)を通じて、ドリンク以外の商品を
--     1点でも注文していれば適用」とする。判定に使う「その明細がドリンク
--     だったか」は注文時点でコピー保存する(item_name / unit_price と同じ
--     スナップショット方式)。あとでカテゴリ構成を変えても、来店中の
--     判定を正しく再現できるようにするため。
--   - 割引は自動適用。お客様の操作は不要で、条件を満たした時点で
--     該当ドリンクの単価から割引額を差し引く。過去に確定した注文の
--     単価は遡って変えない。

alter table public.categories
  add column is_drink boolean not null default false;

comment on column public.categories.is_drink is
  'ドリンクカテゴリか。true の場合のみ商品ごとのセット割引を設定できる';

update public.categories set is_drink = true where name = 'ドリンク';

alter table public.menu_items
  add column combo_discount_name   text,
  add column combo_discount_amount int not null default 0 check (combo_discount_amount >= 0);

comment on column public.menu_items.combo_discount_name is
  'セット割引の名称(例: セット割引)。ドリンク以外の商品と同じ来店内で注文された場合に適用する';
comment on column public.menu_items.combo_discount_amount is
  'セット割引の金額(円、1点あたり)。0 または名称が未設定なら割引なし';

alter table public.order_items
  add column category_is_drink boolean not null default false;

comment on column public.order_items.category_is_drink is
  '注文時点でこの商品がドリンクカテゴリだったかのコピー。セット割引の判定
   (来店中にドリンク以外の商品を注文したか)を、あとでメニュー構成が
   変わっても正しく再現するために保存する';

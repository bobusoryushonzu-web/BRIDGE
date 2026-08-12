-- 提供タイミングの選択可否を「カテゴリ単位」から「商品単位」に変更する
--
-- 変更理由: 同じカテゴリ(例: デザート)の中でも、商品によって食後に回せる
-- ものとそうでないものがある(できたてを出したいスフレと、作り置きできる
-- プリンなど)。BACK-system で商品を追加・編集するときに、商品ごとに
-- 「即提供」か「食後の選択を許可する」かを設定できるようにする。

alter table public.menu_items
  add column allows_timing_choice boolean not null default false;

comment on column public.menu_items.allows_timing_choice is
  '客が提供タイミング(食中/食後)を選べる商品か。商品の追加・編集時に店員が設定する';

alter table public.categories
  drop column allows_timing_choice;

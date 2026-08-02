# BRIDGE

レストランの「注文・追加注文・呼び出し・会計」を、客が店員を探して手を挙げることなくスマートフォンから行えるようにするシステム。店側は依頼を対応済みにするまで画面に残すことで、見落としを防ぐ。

| ドキュメント | 内容 |
|---|---|
| **[docs/SETUP.md](docs/SETUP.md)** | **セットアップ手順(まずこれ。ブラウザだけで30〜40分)** |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 要件定義(機能一覧・データ設計・非機能要件) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 技術構成と設計判断 |

## 構成

```
apps/front-system/   FRONT-system : 客が使う注文用アプリ(QRから開く・ログイン不要)
apps/back-system/    BACK-system  : 店員が使う管理パネル(ログイン必須)
packages/shared/     両アプリ共通の型定義と表示ラベル
supabase/
  migrations/        データベースのスキーマと行レベルセキュリティ
  functions/         Edge Functions(客側の操作はすべてここを経由する)
  tests/             RLS と整合性の検証SQL
  seed.sql           開発用の初期データ
```

使用サービスは **GitHub / Supabase / Vercel の3つのみ**。いずれも無料枠で開始できる。

## セットアップ

**→ ブラウザだけで完結する手順は [docs/SETUP.md](docs/SETUP.md) にある。通常はそちらを使う。**

以下は各手順の要約と、コマンドで行う場合の記載。

### 1. Supabase プロジェクトを作る

1. [supabase.com](https://supabase.com) で New project を作成(Region は **Northeast Asia (Tokyo)** を推奨)
2. Project Settings → API から `Project URL` と `anon public` キーを控える

### 2. データベースを構築する

Supabase CLI を使う場合:

```bash
npm install
npx supabase link --project-ref <プロジェクトの ref>
npx supabase db push
```

CLI を使わない場合は、Supabase ダッシュボードの SQL Editor で
`supabase/migrations/` の SQL を**ファイル名順に**実行する。

### 3. 店員アカウントを作る

Supabase Auth にユーザーを登録しただけでは BACK-system は使えない。
`staff_users` への登録が権限の実体になっている。

1. ダッシュボードの Authentication → Users から店員のユーザーを作成
2. SQL Editor で以下を実行(最初の1人は `admin` にする)

```sql
insert into public.staff_users (id, display_name, role)
values ('<作成したユーザーのUUID>', '店長', 'admin');
```

`admin` は商品・カテゴリ・席の管理ができる。`staff` は注文対応と会計のみ。

### 4. Edge Functions を配置する

```bash
npx supabase functions deploy get-session
npx supabase functions deploy place-order
npx supabase functions deploy get-bill
npx supabase functions deploy call-staff
```

`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は Supabase が自動で渡すため設定不要。
放置セッションを閉じるまでの時間を変えたい場合のみ `STALE_SESSION_HOURS` を設定する(既定 6 時間)。

### 5. アプリをデプロイする

Vercel で **2つのプロジェクト**を作り、同じリポジトリを接続する。

| プロジェクト | Root Directory | 用途 |
|---|---|---|
| bridge-front | `apps/front-system` | 客用。QR コードのリンク先 |
| bridge-back | `apps/back-system` | 店員用 |

どちらにも環境変数を設定する。

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

`anon` キーはブラウザに露出する前提の設計で、これで読めるのはメニューだけ。
**`service_role` キーと DB パスワードは絶対にここに置かない。**

### 6. 席と QR コードを用意する

1. BACK-system にログイン → 「席・QR管理」
2. FRONT-system の URL(例 `https://bridge-front.vercel.app`)を入力
3. 席を追加すると QR コードが表示される
4. 「QR を印刷」で出力し、各席に固定設置する

QR コードは席ごとに固定で、張り替えは不要。

## ローカル開発

```bash
npm install
npx supabase start          # ローカルの Supabase(Docker が必要)
npm run db:reset            # スキーマ適用 + 開発用データ投入

npm run dev:front           # http://localhost:5173
npm run dev:back            # http://localhost:5174
```

各アプリの `.env` に、`supabase start` が表示する API URL と anon キーを設定する。

開発用の店員アカウント: `staff@bridge.local` / `bridge1234`
開発用の QR: `http://localhost:5173/t/dev-token-table-01` (01〜10)

### データベースの検証

Docker が使えない環境でも、素の PostgreSQL があれば行レベルセキュリティと
整合性を検証できる。CI もこの方法で実行している。

```bash
createdb bridge_test
psql -d bridge_test -f supabase/tests/00_supabase_prelude.sql
for f in supabase/migrations/*.sql; do psql -d bridge_test -f "$f"; done
psql -d bridge_test -f supabase/seed.sql
psql -d bridge_test -f supabase/tests/01_rls_and_integrity.sql
```

全16項目が PASS になれば、客が他席の伝票を読めないこと、価格変更後も
過去の伝票が変わらないこと、放置セッションが自動で閉じることなどが確認できる。

## 設計上の要点

- **客に認証はない。** QR トークンが唯一の資格情報で、書き込みはすべて Edge Functions を経由する。データベースへの直接アクセスは行レベルセキュリティで遮断している。
- **商品の削除は論理削除。** 物理削除すると過去の伝票が参照先を失うため。注文明細には注文時点の商品名と価格をコピーしてある。
- **提供状況は商品1点ごとに管理する。** 1回の注文の中で出せた商品と出せていない商品を区別するため。
- **食中と食後は分けて表示する。** 食後の商品は意図的に保留しているもので、未提供一覧に混ぜると本当の遅れが埋もれるため。
- **会計完了の忘れに備えた安全装置。** 最終注文から一定時間が過ぎたセッションは自動的に閉じる。

## 既知の注意点

- **Vercel の無料プラン(Hobby)は非商用利用に限定されている。** 実店舗の営業で使う段階では Pro への変更が必要。無料を維持したい場合は Cloudflare Pages へ移行できる。静的配信のためビルド設定の変更のみで済み、コードの修正は発生しない。
- **Supabase の無料プランは7日間アクセスがないとプロジェクトが停止する。** 日々営業していれば問題ないが、長期休業時はダッシュボードから復帰させる。
- **商品画像は扱っていない。** Supabase の転送量(月5GB)を超過する可能性が最も高い項目のため。必要になった場合は Vercel 側から配信する。
- `npm audit` が react-router に高深刻度を1件報告するが、これは RSC(サーバーコンポーネント)モード限定の問題で、静的 SPA として動く本アプリには該当しない。より古いバージョンへ下げると別の脆弱性が14件に増えるため、最新版を使用している。

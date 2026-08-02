# B.R.I.D.G.E システム構成設計書

**B.R.I.D.G.E** — レストランにおける「注文・追加注文・店員呼び出し・会計依頼」を、客が店員を探して手を挙げることなくスマートフォンから行えるようにし、店側も見落としなく効率的に処理できるようにするシステム。

---

## 1. 全体像

アプリは 2 つに分け、バックエンドは Supabase に集約します。

```
                        ┌──────────────────────────────┐
                        │          Supabase            │
 ┌───────────────┐      │  ┌────────────────────────┐  │      ┌───────────────┐
 │  客用アプリ    │◄────►│  │ PostgreSQL (RLS)       │  │◄────►│  店員用アプリ  │
 │  (customer)   │      │  ├────────────────────────┤  │      │  (staff)      │
 │               │      │  │ Auth (匿名 / メール)    │  │      │               │
 │ QRから入店     │      │  ├────────────────────────┤  │      │ 注文管理       │
 │ メニュー閲覧   │      │  │ Realtime (変更配信)     │  │      │ 呼び出し対応   │
 │ 注文/追加注文  │      │  ├────────────────────────┤  │      │ 会計処理       │
 │ 店員呼び出し   │      │  │ Storage (商品画像)      │  │      │ メニュー管理   │
 │ 会計依頼       │      │  ├────────────────────────┤  │      │ テーブル管理   │
 └───────────────┘      │  │ Edge Functions          │  │      └───────────────┘
                        │  └────────────────────────┘  │
                        └──────────────────────────────┘
```

- **客用アプリ (customer)**: テーブルに置かれた QR コードを読み取ってアクセス。ログイン不要(匿名認証)。
- **店員用アプリ (staff)**: 店員がメールアドレス+パスワードでログイン。注文・呼び出しがリアルタイムで届く。
- **Supabase**: DB・認証・リアルタイム配信・画像ストレージ・サーバーサイド処理をすべて担う。自前のバックエンドサーバーは不要。

「見落としがない」ことの要は **Supabase Realtime**。注文や呼び出しは DB への INSERT と同時に店員画面へプッシュ配信され、対応済みにするまで画面に残り続けます。

## 2. 技術スタック

| 領域 | 採用技術 | 理由 |
|---|---|---|
| フロントエンド | Next.js (React) + TypeScript | 2アプリを同じ技術で統一。型を共有できる |
| スタイリング | Tailwind CSS | スマホ最適化UIを素早く構築 |
| バックエンド | Supabase (PostgreSQL / Auth / Realtime / Storage / Edge Functions) | サーバー運用不要でリアルタイム性を確保 |
| リポジトリ | GitHub (モノレポ) | 2アプリ+DB定義を1リポジトリで管理 |
| CI/CD | GitHub Actions + Vercel | push で自動テスト・自動デプロイ |
| ホスティング | Vercel (customer / staff を別プロジェクトとしてデプロイ) | Next.js と相性が良く無料枠で開始可能 |

## 3. リポジトリ構成(モノレポ)

```
BRIDGE/
├── apps/
│   ├── customer/                # 客用アプリ (Next.js)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── t/[qrToken]/         # QR入店 → セッション開始
│   │       │   ├── menu/                # メニュー閲覧・カート
│   │       │   ├── orders/              # 注文履歴・ステータス確認
│   │       │   └── checkout/            # 会計依頼
│   │       └── components/
│   └── staff/                   # 店員用アプリ (Next.js)
│       └── src/
│           ├── app/
│           │   ├── login/               # 店員ログイン
│           │   ├── dashboard/           # 注文・呼び出し一覧(リアルタイム)
│           │   ├── tables/              # テーブル・QR管理
│           │   ├── menu/                # 商品・カテゴリ管理(CRUD)
│           │   └── checkout/            # 会計処理
│           └── components/
├── packages/
│   └── shared/                  # 共有パッケージ
│       ├── types/               # DBから生成した型定義 (supabase gen types)
│       ├── supabase/            # Supabaseクライアント初期化
│       └── utils/               # 金額計算などの共通ロジック
├── supabase/
│   ├── migrations/              # DBスキーマのマイグレーションSQL
│   ├── functions/               # Edge Functions (会計確定処理など)
│   └── seed.sql                 # 開発用初期データ
├── .github/
│   └── workflows/
│       ├── ci.yml               # lint / typecheck / test
│       └── db-migrate.yml       # main マージ時に supabase db push
├── docs/
│   └── ARCHITECTURE.md          # 本書
├── package.json                 # npm workspaces ルート
└── turbo.json                   # (任意) タスクランナー
```

## 4. データベース設計

### ER 図(概要)

```
tables ──< table_sessions ──< orders ──< order_items >── menu_items >── categories
                │
                └──< staff_calls
staff_profiles (店員: Supabase Auth ユーザーに紐付く)
```

### テーブル定義

| テーブル | 役割 | 主なカラム |
|---|---|---|
| `tables` | 物理テーブル(卓) | `id`, `table_number`, `qr_token`(QR用の推測不能な文字列), `is_active` |
| `table_sessions` | 来店1回分のセッション | `id`, `table_id`, `status`(`active` / `checkout_requested` / `closed`), `started_at`, `closed_at` |
| `categories` | 商品カテゴリ | `id`, `name`, `sort_order`, `is_active` |
| `menu_items` | 商品 | `id`, `category_id`, `name`, `description`, `price`, `image_url`, `is_available`(売り切れ切替), `sort_order` |
| `orders` | 注文(1回の送信単位) | `id`, `session_id`, `status`(`pending` → `accepted` → `preparing` → `served`、または `cancelled`), `created_at` |
| `order_items` | 注文明細 | `id`, `order_id`, `menu_item_id`, `quantity`, `unit_price`(**注文時点の価格スナップショット**), `notes`(「ネギ抜き」等) |
| `staff_calls` | 店員呼び出し | `id`, `session_id`, `type`(`call`=呼び出し / `checkout`=会計依頼), `status`(`open` / `handled`), `created_at`, `handled_by` |
| `staff_profiles` | 店員プロフィール | `id`(= auth.users.id), `display_name`, `role`(`admin` / `staff`) |

設計上のポイント:

- **価格は `order_items.unit_price` にスナップショット保存**。後からメニュー価格を変更しても過去の会計金額が変わらない。
- **会計金額はセッション内の全 `order_items` から集計**。追加注文が何回あっても 1 セッション = 1 会計。
- `qr_token` はテーブル番号そのものではなくランダム文字列にし、他の卓へのなりすましを防ぐ。会計完了(セッション close)時にローテーション可能。

### 認証と RLS(行レベルセキュリティ)

| 利用者 | 認証方式 | アクセス範囲 |
|---|---|---|
| 客 | Supabase **匿名認証**(QR読み取り時に自動サインイン) | 自分のセッションに属する注文・呼び出しのみ読み書き可。メニューは閲覧のみ |
| 店員 | メール+パスワード(`staff_profiles` に `role` 保持) | 全注文・全呼び出し・テーブルの読み書き。メニュー編集は `admin` のみ等も設定可 |

すべてのテーブルで RLS を有効化し、「客は自セッションのみ」「店員はロールに応じて全体」をポリシーで強制します。フロントエンドには anon キーしか置かないため、URL を直接叩かれても他卓のデータには触れません。

### Edge Functions(サーバーサイド処理)

クライアントに任せると改ざんできてしまう処理のみ Edge Functions に置きます。

- `start-session`: QR トークン検証 → アクティブセッションの取得または作成
- `place-order`: 在庫(`is_available`)確認・価格スナップショット付与・注文作成をトランザクションで実行
- `close-session`: 会計確定。合計を計算してセッションを close し、QR トークンをローテーション

## 5. 主要フロー

### 注文フロー

```
客: QR読取 → 匿名サインイン → セッション開始/復帰 → メニューをカートへ → 注文送信
                                                            │ INSERT orders
店員: ダッシュボードに Realtime で即時表示(音+バッジ) ◄────┘
      → 「受付」→「調理中」→「提供済み」とステータス更新
客: 自分の注文ステータスが Realtime で画面に反映される
```

### 店員呼び出し / 会計フロー

```
客: 「店員を呼ぶ」or「会計する」ボタン → INSERT staff_calls
店員: 呼び出し一覧に即時表示。対応したら「対応済み」に更新(見落とし防止:未対応は残り続ける)
会計: 店員がセッションの合計金額を確認 → レジ操作(現金/カード) → close-session 実行
      → セッション終了・QRローテーション → 卓は次の客を受け入れ可能に
```

※ 決済そのもの(Stripe 等のオンライン決済)は初期スコープ外とし、「会計依頼 → 店員がレジで精算」とします。後から Edge Function 経由で Stripe を足せる設計です。

## 6. 開発の進め方(フェーズ分け)

| フェーズ | 内容 |
|---|---|
| **Phase 1: 基盤** | モノレポ初期化 / Supabase プロジェクト作成 / スキーマ・RLS のマイグレーション / 型生成 / CI |
| **Phase 2: 店員アプリ最小版** | ログイン / カテゴリ・商品 CRUD(画像は Storage へ) / テーブル・QR コード発行 |
| **Phase 3: 客アプリ最小版** | QR 入店 / メニュー閲覧 / カート / 注文送信 / 注文履歴 |
| **Phase 4: リアルタイム連携** | 店員ダッシュボード(新着注文・呼び出しの Realtime 購読 / 通知音) / 注文ステータス更新の双方向反映 |
| **Phase 5: 会計** | 会計依頼 / セッション合計表示 / close-session / QR ローテーション |
| **Phase 6: 磨き込み** | 売り切れ表示 / 注文集計・簡易売上画面 / 多言語化 / PWA 化(ホーム画面追加・通知) |

## 7. 環境・デプロイ

- **環境変数**: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` を Vercel の各プロジェクトに設定。`service_role` キーは Edge Functions / GitHub Actions Secrets のみに置き、フロントには絶対に出さない。
- **デプロイ**: `apps/customer` と `apps/staff` を Vercel の別プロジェクトとして接続し、`main` への push で自動デプロイ。
- **DB マイグレーション**: ローカルで `supabase migration new` → PR レビュー → `main` マージ時に GitHub Actions が `supabase db push`。
- **開発環境**: `supabase start`(ローカル Docker)で本番に影響なく開発。

---

以上を初期構成とし、Phase 1 のモノレポ初期化とスキーマ定義から着手します。

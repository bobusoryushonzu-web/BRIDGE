# BRIDGE システム構成設計書

**BRIDGE** — レストランにおける「注文・追加注文・店員呼び出し・会計依頼」を、客が店員を探して手を挙げることなくスマートフォンから行えるようにし、店側も見落としなく効率的に処理できるようにするシステム。

要件は `docs/REQUIREMENTS.md` に定義する。本書はそれを実現する技術構成を記載する。

---

## 1. 全体像

アプリは 2 つに分け、バックエンドは Supabase に集約します。

```
                          ┌──────────────────────────────┐
                          │          Supabase            │
 ┌────────────────┐       │  ┌────────────────────────┐  │      ┌────────────────┐
 │ FRONT-system   │       │  │ Edge Functions         │  │      │  BACK-system   │
 │ (注文用アプリ)  │──────►│  │ トークン検証・注文作成  │  │      │ (管理パネル)    │
 │                │       │  ├────────────────────────┤  │      │                │
 │ QRから入店      │       │  │ PostgreSQL (RLS)       │  │◄────►│ 商品管理        │
 │ メニュー・注文  │◄──────│  ├────────────────────────┤  │      │ 注文照会        │
 │ 食中/食後の指定 │  参照 │  │ Realtime (変更配信)     │──┼─────►│ 提供状況        │
 │ 呼び鈴・会計    │  のみ │  ├────────────────────────┤  │ 即時 │ 呼び出し・会計   │
 │ デジタル伝票    │       │  │ Auth (店員のみ)         │  │      │ 席・QR管理      │
 └────────────────┘       │  └────────────────────────┘  │      └────────────────┘
      認証なし             └──────────────────────────────┘        メール+パスワード
   QRトークンが鍵
```

- **FRONT-system(注文用アプリ)**: 席に固定設置された QR コードを読み取ってアクセス。インストールもログインも不要。データベースへは直接触れず、書き込みはすべて Edge Functions 経由。
- **BACK-system(従業員操作用管理パネル)**: 店員がメールアドレス+パスワードでログイン。注文・呼び出し・会計依頼がリアルタイムで届く。
- **Supabase**: データベース・店員認証・リアルタイム配信・サーバー側処理をすべて担う。自前のバックエンドサーバーは不要。

「見落としがない」ことの要は **Supabase Realtime**。注文や呼び出しはデータベースへの登録と同時に BACK-system へプッシュ配信され、対応済みにするまで画面に残り続ける。

## 2. 技術スタック

| 領域 | 採用技術 | 理由 |
|---|---|---|
| フロントエンド | Vite + React + TypeScript | 静的SPAとして配信。2アプリを同じ技術で統一し型を共有できる |
| ルーティング | React Router | 画面遷移の管理 |
| スタイリング | Tailwind CSS | スマホ最適化UIを素早く構築 |
| バックエンド | Supabase (PostgreSQL / Auth / Realtime / Storage / Edge Functions) | サーバー運用不要でリアルタイム性を確保 |
| リポジトリ | GitHub (モノレポ) | 2アプリ+DB定義を1リポジトリで管理 |
| CI/CD | GitHub Actions + Vercel | push で自動テスト・自動デプロイ |
| ホスティング | Vercel (FRONT-system / BACK-system を別プロジェクトとしてデプロイ) | GitHub 連携で自動デプロイ。※Hobby プランは非商用限定のため、実店舗の営業で使う段階では Pro への切り替えが必要 |

### 技術選定の判断: なぜ Next.js ではないか

当初 Next.js を候補としたが、以下の理由で Vite + React を採用した。

Supabase のクライアント SDK がブラウザから認証・データ取得・リアルタイム購読をすべて処理するため、**サーバーを経由する処理が存在しない**。加えて本システムは QR とログインの向こう側にある業務アプリであり、SEO も不要。その結果 Next.js の主要機能(Server Components / SSR、API Routes、Middleware、ISR、`next/image` 最適化)がいずれも使われず、残るのはルーティングとビルドのみとなる。

Vite なら同じことをより軽量に実現でき、開発サーバーの起動とホットリロードが高速で、Server / Client Component の使い分けを考える必要もない。出力は純粋な静的ファイルのため、ホスティング先の制約も受けない。

将来 SSR や SEO が必要になった場合(例: 店の公開メニューページを検索に載せる)は、そのページのみ別途対応する。

## 3. リポジトリ構成(モノレポ)

```
BRIDGE/
├── apps/
│   ├── front-system/            # FRONT-system: 注文用アプリ(客) Vite + React
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx                  # ルーティング定義
│   │       ├── routes/
│   │       │   ├── Entry.tsx            # /t/:qrToken  QR入店・席特定      FR-01
│   │       │   ├── Menu.tsx             # /menu        メニュー・カート     FR-02〜04
│   │       │   ├── MyOrders.tsx         # /orders      注文内容と提供状況   FR-05
│   │       │   └── Bill.tsx             # /bill        デジタル伝票        FR-09
│   │       ├── components/              # 呼び鈴・食後提供合図など          FR-06〜08
│   │       └── lib/                     # Edge Function 呼び出し・カート状態
│   └── back-system/             # BACK-system: 従業員操作用管理パネル Vite + React
│       ├── index.html
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── routes/
│           │   ├── Login.tsx            # 店員ログイン                    BK-13
│           │   ├── Dashboard.tsx        # 新規注文・呼び出し・会計通知     BK-08〜11
│           │   ├── Serving.tsx          # 提供状況(食中/食後)・提供済み  BK-06, BK-07
│           │   ├── Orders.tsx           # 注文照会・会計完了              BK-05, BK-12
│           │   ├── MenuAdmin.tsx        # 商品・カテゴリ管理              BK-01〜04
│           │   └── Tables.tsx           # 席と QR コードの管理             BK-14
│           ├── components/
│           └── lib/                     # Supabaseクライアント・Realtime購読
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
tables ──< sessions ──< orders ──< order_items >── menu_items >── categories
              │
              └──< staff_calls
staff_users (店員: Supabase Auth ユーザーに紐付く)
```

各カラムの定義は `docs/REQUIREMENTS.md` 4章を参照。ここでは実装上のポイントのみ記載する。

- **価格と商品名は `order_items` にコピー保存**(`unit_price` / `item_name`)。メニューを後から変更しても過去の伝票は変わらない。
- **商品の削除は論理削除**(`menu_items.is_deleted`)。物理削除すると過去の注文明細が参照先を失うため。
- **提供状況は `order_items.status` で1点ごとに管理**。1回の注文の中で出せた商品と出せていない商品を区別する必要があるため。
- **`order_items.serve_timing`** が `during`(食中)/ `after`(食後)を保持する。店員画面はこれで表示を分ける。
- **`qr_token` は席ごとに固定**でローテーションしない(要件による)。席番号ではなく推測不能なランダム値を用いてなりすましを防ぐ。
- **会計金額はセッション内の全 `order_items` から集計**。追加注文が何回あっても 1 セッション = 1 会計。
- 1つの席に `active` なセッションは同時に1つだけ。部分ユニークインデックスでデータベース側から保証する。

### 認証と RLS(行レベルセキュリティ)

| 利用者 | 認証方式 | データベースへのアクセス |
|---|---|---|
| 客 | **なし**。QR トークンが唯一の資格情報 | 直接アクセス不可。`menu_items` / `categories` の SELECT のみ許可 |
| 店員 | Supabase Auth(メール+パスワード) | 全テーブルの読み書き。商品・席の管理は `admin` ロールのみ |

全テーブルで RLS を有効化する。客側のフロントエンドが持つのは anon キーのみで、注文・伝票・呼び出しの各テーブルには anon ロールからの権限を一切与えない。したがって URL やキーを直接叩かれても他席のデータには到達できない。

客の操作はすべて Edge Functions を経由し、そこで QR トークンを検証したうえで `service_role` で処理する。**判断をサーバー側に集約することで、クライアントを信用しなくてよい構造にする。**

### Edge Functions(サーバーサイド処理)

客側の操作はすべてここを通す。

| 関数 | 対応する要件 | 処理 |
|---|---|---|
| `get-session` | FR-01 | QR トークンを検証し、席とアクティブセッションを返す(なければ席情報のみ) |
| `place-order` | FR-04 | トークン検証 → 品切れ確認 → セッションが無ければ作成 → 商品名・価格をコピーして注文を作成 |
| `get-bill` | FR-05, FR-09 | トークン検証 → 未会計セッションの全明細と合計金額を返す |
| `call-staff` | FR-06, FR-07, FR-08 | トークン検証 → 呼び出しを作成(`bell` / `serve_after` / `checkout`) |

店員側は認証済みのため Edge Functions を介さず、Supabase クライアントから直接読み書きする(RLS で保護)。

## 5. 主要フロー

### 注文フロー

```
客: QR読取 → get-session(トークン検証・席特定) → メニュー選択(食中/食後を指定)
                                                            │ place-order
店員: BACK-system に Realtime で即時表示(音+バッジ) ◄──────┘
      → 商品を出したら1点ずつ「提供済み」に更新
```

### 呼び出し / 会計フロー

```
客: 「呼び鈴」/「食後の商品を出して」/「会計」 → call-staff
店員: 未対応リストに種別と席番号が即時表示。対応したら「対応済み」に更新
                              ※未対応のまま残り続けるので見落としが起きない
会計: 客の画面に get-bill でデジタル伝票を表示
      店員が合計金額を確認 → レジで精算 → 「会計完了」でセッションを閉じる
      → 席が次の客を受け入れ可能に(QRは固定なので張り替え不要)
```

※ オンライン決済は要件定義でスコープ外としています(`docs/REQUIREMENTS.md` 2.2)。

## 6. 開発の進め方(フェーズ分け)

| フェーズ | 内容 | 対応する要件 |
|---|---|---|
| **Phase 1: 基盤** | モノレポ初期化 / スキーマ・RLS のマイグレーション / 型生成 / CI | — |
| **Phase 2: BACK-system 商品管理** | 店員ログイン / カテゴリ管理 / 商品の追加・編集・論理削除 / 席と QR の発行 | BK-01〜04, BK-13, BK-14 |
| **Phase 3: FRONT-system 注文** | QR 入店 / メニュー表示 / 食中・食後の選択 / 注文送信 / 注文内容の確認 | FR-01〜05 |
| **Phase 4: BACK-system 注文・提供管理** | 新規注文のリアルタイム受信 / 注文照会 / 提供状況(食中・食後を分けて表示)/ 提供済み記録 | BK-05〜08 |
| **Phase 5: 呼び出しと会計** | 呼び鈴 / 食後提供の合図 / 会計依頼 / デジタル伝票 / 会計完了とセッションクローズ | FR-06〜09, BK-09〜12 |
| **Phase 6: 運用対応** | セッション自動クローズ(OP-01)/ 通知音・未対応の強調表示 / PWA 化 | OP-01 |

## 7. 環境・デプロイ

- **環境変数**: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を Vercel の各プロジェクトに設定(Vite ではビルド時に `VITE_` 接頭辞の変数のみクライアントへ埋め込まれる)。`anon` キーはブラウザに露出する前提の設計で、保護は RLS が担う。`service_role` キーと DB パスワードは Edge Functions / GitHub Actions Secrets のみに置き、フロントには絶対に出さない。
- **デプロイ**: `apps/front-system` と `apps/back-system` を Vercel の別プロジェクトとして接続(Root Directory にそれぞれのパスを指定)し、`main` への push で自動デプロイ。ビルド成果物は静的ファイルのみ。
- **SPA のルーティング対応**: 静的配信では `/menu` などへの直接アクセスが 404 になるため、全経路を `index.html` にフォールバックさせる設定を各アプリに置く。
- **DB マイグレーション**: ローカルで `supabase migration new` → PR レビュー → `main` マージ時に GitHub Actions が `supabase db push`。
- **開発環境**: `supabase start`(ローカル Docker)で本番に影響なく開発。

---

以上を初期構成とし、Phase 1 のモノレポ初期化とスキーマ定義から着手します。

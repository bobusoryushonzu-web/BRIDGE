# BRIDGE セットアップ手順

コードは完成しているが、お客様の Supabase / Vercel には**まだ何も繋がっていない**。
この文書のとおりに進めると、実際に注文が通る状態になる。

所要時間はおよそ 30〜40 分。**すべてブラウザだけで完結し、コマンド操作は不要**。

---

## 全体の流れ

```
STEP 1  Supabase プロジェクトを作る                   (5分)
STEP 2  GitHub に Secrets を登録する                  (5分)
STEP 3  Actions を実行してデータベースを構築する       (3分)
STEP 4  店員アカウントを作る                          (5分)
STEP 5  Vercel に2つのアプリをデプロイする            (10分)
STEP 6  席の QR コードを発行して動作確認する          (10分)
```

---

## STEP 1: Supabase プロジェクトを作る

すでに作成済みならこの手順は飛ばし、必要な値だけ控える。

1. https://supabase.com/dashboard → **New project**
2. 入力する
   - **Name**: `bridge`
   - **Database Password**: 強力なものを生成し、**必ず控える**(後から再表示できない)
   - **Region**: `Northeast Asia (Tokyo)`
3. 作成完了まで2分ほど待つ

### 控える値(3つ)

| 値 | 場所 |
|---|---|
| **Project URL** | Project Settings → API → Project URL(`https://xxxx.supabase.co`) |
| **anon public キー** | Project Settings → API → Project API keys → `anon` `public` |
| **Project ref** | ダッシュボードの URL `https://supabase.com/dashboard/project/` の後ろの文字列 |

さらにアクセストークンを発行する。

4. https://supabase.com/dashboard/account/tokens → **Generate new token**
   - 名前は `github-actions` など
   - 表示されたトークンを控える(**この画面を閉じると二度と表示されない**)

---

## STEP 2: GitHub に Secrets を登録する

GitHub の Secrets は暗号化されて保存され、ログにも表示されない。
**パスワードやトークンはここに入れる。チャットやコードには絶対に書かない。**

1. https://github.com/bobusoryushonzu-web/BRIDGE/settings/secrets/actions
2. **New repository secret** で3つ登録する

| Name | Secret に入れる値 |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | STEP 1-4 で発行したアクセストークン |
| `SUPABASE_PROJECT_REF` | STEP 1 で控えた Project ref |
| `SUPABASE_DB_PASSWORD` | STEP 1-2 で決めたデータベースのパスワード |

---

## STEP 3: Actions を実行してデータベースを構築する

1. https://github.com/bobusoryushonzu-web/BRIDGE/actions
2. 左の一覧から **「Supabase へデプロイ」** を選ぶ
3. 右上の **Run workflow** → ブランチに `claude/bridge-restaurant-system-bst96x` を選んで実行

これで以下が自動で行われる。

- 8つのテーブルと行レベルセキュリティの作成
- Edge Functions 4本(`get-session` / `place-order` / `get-bill` / `call-staff`)の配置

緑のチェックが付けば成功。**赤くなった場合は、そのログを共有してもらえれば原因を調べる。**

---

## STEP 4: 店員アカウントを作る

Supabase Auth にユーザーを作っただけでは BACK-system は使えない。
`staff_users` テーブルへの登録が権限の実体になっている。
(これは安全のための設計で、外部の誰かが勝手にサインアップしても管理画面には入れない)

1. Supabase ダッシュボード → **Authentication** → **Users** → **Add user** → **Create new user**
   - メールアドレスとパスワードを入力
   - **Auto Confirm User** を **オン** にする(確認メールを省略するため)
2. **SQL Editor** を開き、以下を実行(メールアドレスを差し替える)

```sql
insert into public.staff_users (id, display_name, role)
select id, '店長', 'admin' from auth.users
 where email = 'ここに店員のメールアドレス'
on conflict (id) do update set role = 'admin';
```

`admin` は商品・席の管理まで可能。追加の店員を `staff` で登録すると、注文対応と会計のみ行える。

3. **Authentication** → **Providers** → **Email** → 「Allow new users to sign up」を **オフ** にする

> これをオフにしないと、URL を知った第三者が勝手にアカウントを作れてしまう。
> (`staff_users` に登録されない限り管理画面には入れないが、不要なアカウントは作らせない方がよい)

---

## STEP 5: Vercel に2つのアプリをデプロイする

**同じリポジトリから2つのプロジェクトを作る。**

### 5-1. 客用アプリ(FRONT-system)

1. https://vercel.com/new → GitHub の **BRIDGE** を **Import**
2. 設定する
   - **Project Name**: `bridge-front`
   - **Root Directory**: **Edit** を押して `apps/front-system` を選ぶ ← **重要**
   - Framework Preset は `Vite` が自動で選ばれる
3. **Environment Variables** に2つ追加

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | STEP 1 の Project URL |
   | `VITE_SUPABASE_ANON_KEY` | STEP 1 の anon public キー |

4. **Deploy**

### 5-2. 店員用アプリ(BACK-system)

同じ手順を繰り返す。変えるのは2箇所だけ。

- **Project Name**: `bridge-back`
- **Root Directory**: `apps/back-system`

環境変数は FRONT と**まったく同じ2つ**を設定する。

### デプロイするブランチについて

初期状態では `main` ブランチがデプロイ対象になる。今回のコードは
`claude/bridge-restaurant-system-bst96x` ブランチにあるため、どちらかを行う。

- **A**: このブランチを `main` にマージする(推奨)
- **B**: Vercel の Settings → Git → Production Branch をこのブランチ名に変更する

---

## STEP 6: 席の QR コードを発行して動作確認する

1. `bridge-back` の URL を開き、STEP 4 で作った店員アカウントでログイン
2. **席・QR管理** を開く
3. 「注文用アプリ(FRONT-system)の URL」に `bridge-front` の URL を貼る
   (例 `https://bridge-front.vercel.app`)
4. **席を追加** で席番号を登録する(1, 2, 3 … または A-1 など)
5. **商品管理** でカテゴリと商品を登録する
   - デザート・ドリンクのカテゴリは「お客様が食中/食後を選べるようにする」に**チェックを入れる**

### 動作確認

1. スマートフォンで席の QR コードを読み取る
2. メニューが表示されたら、商品を選んで注文する
3. **PC 側の BACK-system のダッシュボードに、注文が数秒以内に現れれば連携成功**
4. 「呼ぶ」ボタン、「お会計」ボタンも試す

---

## うまくいかないときの確認箇所

| 症状 | 確認すること |
|---|---|
| 画面が真っ白 | Vercel の環境変数 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` が設定されているか。**変更したら再デプロイが必要**(ビルド時に埋め込まれるため) |
| 「この QR コードは無効です」 | 席・QR管理で入力した FRONT-system の URL が正しいか。末尾に `/` を付けない |
| メニューが空 | 商品管理で商品を登録したか。カテゴリだけでは表示されない |
| ログインできない | STEP 4 の SQL を実行したか。`select * from public.staff_users;` で行があるか確認 |
| 「利用権限がありません」と出る | ログインは成功しているが `staff_users` に未登録。STEP 4-2 の SQL を実行する |
| 注文しても BACK に出ない | Supabase → Database → Replication で `supabase_realtime` に4テーブルが入っているか。入っていなければ画面の更新ボタンで表示はされる |
| Actions が赤くなる | ログを確認する。多くは Secrets の値の誤り(前後の空白に注意) |

---

## 運用を始める前に

- **Vercel の無料プラン(Hobby)は非商用利用に限定されている。** 実際の営業で使う段階では Pro(月20ドル)への変更が必要。無料を維持したい場合は Cloudflare Pages へ移行できる(静的配信のため設定変更のみでコード修正は不要)。
- **Supabase の無料プランは7日間アクセスがないとプロジェクトが停止する。** 日々営業していれば問題ない。長期休業の際はダッシュボードから復帰させる。
- 会計完了の操作を忘れても、最終注文から6時間で自動的にセッションが閉じる。

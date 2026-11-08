# 同一ワークスペースに複数の認証プロファイルを並べる

## 目的 / 背景

registry も local session も Team ID 単位（session は Team ID × credential kind）で、同じワークスペースに別の Slack アプリのトークン（例: 普段使いの xoxp と新しいアプリの xoxp / xoxb）を並べられない。`auth session start` で別トークンを入れると既存 session を置き換える（実際は「active な session が既にある」で拒否されるか、revoke すると既存利用者の session が消える）。コマンドごとに識別を選べるようにする。

## スコープ

やること: workspace record に名前付き「profile」を複数持てるようにし、`--profile <name>` で CLI 全体から選べるようにする。profile ごとに session を分ける。
やらないこと: profile 未指定時の挙動変更、環境変数での profile 選択（暗黙の選択を増やさない）、トークン値の保存、registry の version 変更。

## 決定（実装が分岐する点）

1. **名前**: 「profile」。形式は alias と同じ `^[a-z0-9]+(?:-[a-z0-9]+)*$`、長さ 1〜32。`default` は予約語（無印を指すため）として拒否。
2. **registry**: `WorkspaceRecord` に任意の `profiles?: { name: string; credentialRefs: WorkspaceCredentialRefs }[]` を足す。`credentialRefs` は既存の形式（user / bot のどちらか以上、環境変数名の参照のみ）。名前は workspace 内で一意。キー `profiles` が無い既存 registry はそのまま読める（version は 1 のまま）。`profiles` が空配列なら保存時に省略する。
3. **選択**: ルートオプション `--profile <name>`。**`--workspace` / `SLAMY_DEFAULT_WORKSPACE` / registry default のいずれかで workspace が決まっている場合だけ有効**。選べない・名前が無い・legacy 経路（workspace 未解決）のときは throw し、無印の credential や legacy token へ fallback しない。permalink から workspace が決まる場合も、その workspace の profile を探す（無ければ throw）。`--profile` を重複指定して値が違えば `--workspace` と同様に拒否。
4. **credential の差し替え**: profile を選んだときの有効な `credentialRefs` は profile のものだけ（無印の `credentialRefs` とマージしない）。`requirementFor` / session の kind 判定 / credentialResolver には、`credentialRefs` を profile のもので置き換え `profile` 名を付けた record（`WorkspaceView` に任意の `profile?: string` を追加）を渡す。
5. **session の分離**: profile 指定時の session ディレクトリは `sessions/<teamId>/profiles/<profile>/<kind>/`、socket は `<runtime>/<teamId>-<kind>-<profile>.sock`。無印のパスは**一切変えない**。profile 指定時に無印の session を読まない・書かない・revoke しない（逆も同じ）。`LocalSessionConnection` の形式は変えない（socketPath の一致検査が profile の取り違えを防ぐ）。
6. **session コマンド**: `auth session start|status|revoke` はルートの `--profile` に従う。status / start の出力に `profile`（無印は省略）を足す。`--plain` の列は無印のとき従来のまま、profile 指定時のみ末尾に profile 列を足す。identity 検証（Team ID 一致・kind と bot/user の一致）は従来どおり。
7. **管理コマンド（オフライン）**: `workspace profile add <selector> <name> [--user-token-env <ENV>] [--bot-token-env <ENV>]`、`workspace profile list <selector>`、`workspace profile remove <selector> <name>`。remove は registry だけを変え、稼働中の session には触れない。`workspace show/list` の出力は無印のとき従来のまま、profile があるときのみ profile 名の一覧を足す。
8. **秘匿**: トークンは stdin（`auth session start`）か環境変数名の参照のみ。argv・ログ・エラー文・registry に値を出さない。

## 受け入れ条件

- A. profile を指定しない全経路（registry 読み書き、session のパス・socket・出力、client 生成）が変更前と同一の結果になる（既存テストが無変更で通る）。
- B. 同じ Team ID に profile `a`（user）と `b`（bot）と無印の session を同時に start でき、どれかの revoke / 期限切れが他に影響しない。
- C. `--profile` 指定で `auth test` / `chat` / `messages` の投稿 / `assistant set-status` が、その profile の session（無ければその profile の credentialRefs）で client を作る。無印へも別 workspace へも fallback しない。
- D. profile 名の不在、workspace 未決定、legacy 経路、予約語・不正形式、重複、はいずれも throw。
- E. 古い `credentialRefs` のみの registry と `profiles` ありの registry の双方を decode / serialize で往復できる。
- F. README を更新（選択の順序・使い方・session の分離）。

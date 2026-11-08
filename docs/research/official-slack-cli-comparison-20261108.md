# 公式Slack CLIとslamyの比較（2026-11-08）

## 結論

- **Slackの公式CLIは存在する。** [slackapi/slack-cli](https://github.com/slackapi/slack-cli)で、コマンド名は`slack`。
- **v4.1.0（2026-05-19）で`slack api`が加わり、任意のAPIメソッドを呼べる。** ただしAPIを直接呼ぶ入口であり、slamyが担う運用機能の代わりにはならない。
- **`slack-cli`への改名は勧めない。** 公式のrepo名と同じになり、どちらを指すか区別できなくなる。
- 単発のAPI呼び出しには`slack api`を併用できる。

## 公式CLIの基本情報

確認日: 2026-11-08。

| 項目 | 値 |
|---|---|
| 提供元 | 公式（GitHub org `slackapi`） |
| GitHubスター数 | 315 |
| 最新リリース | v4.13.0（2026-11-05 JST。元: 2026-11-04T23:25:10Z） |
| 直近のpush | 2026-11-07 JST（元: 2026-11-06T21:25:20Z） |
| ライセンス | Apache-2.0 |
| 主な用途 | Slackアプリの作成・実行・配備。repoの説明は「Create, develop, and deploy Slack apps from the command-line」 |

## 比較

「未確認」は、下の「未確認のこと」に挙げたもの。

| 機能 | 公式`slack api` | slamy |
|---|---|---|
| 投稿・更新・削除、リアクション | できる（メソッドを直接指定） | できる（サブコマンド） |
| Slackのpermalinkを指定して操作 | 例はすべてIDの指定 | `threads replies`などが受け付ける |
| 自動ページング | `api.go`に該当の処理なし | `src/slack/pagination.ts` |
| ローカルファイルの添付 | フラグにファイル指定なし。`api.go`にmultipartの処理なし | `files upload`、`files download` |
| 複数ワークスペース | `--team`、`--token` | `workspace`のレジストリ、`--workspace`、`--profile` |
| トークンの受け取り | `--token`（argv）か環境変数 | 環境変数とローカルセッション（`auth session`） |
| 出力の整形 | Slackの応答JSONをそのまま出す | `--json`、`--plain`、`--tz` |
| mrkdwnの補正 | なし（`api.go`に該当の処理なし） | `src/lib/mrkdwn.ts` |
| 集計 | なし | `engagement` |
| TypeScriptから呼ぶライブラリ | なし（CLIのみ） | `dist/lib/index.js`を公開 |

## 注意すべき点

- `slack api --help`の例にある`files.upload`は、Slackの文書で「2025-11-12に停止する」と告知されたメソッドで、移行先は`files.getUploadURLExternal`と`files.completeUploadExternal`である。
- `--token`はargvへトークンを渡す形になる。トークンをargvに置かない運用では、環境変数で渡す。
- `search.messages`は文書で「legacy method」とされ、`assistant.search.context`が推奨されている。停止日の記載は無い。**これは公式CLIとは別の話で、`slamy search messages`にも関わる。**

## `slack-cli`へ改名する場合の費用

- 公式のrepoと同じ名前になる。`tackeyy/slack-cli`自体は2026-11-08時点で未使用。
- 名前で分岐する箇所が複数のrepoにある。起動ラッパー、権限の許可リスト、直接APIを止めるhook、スキル、規約。
- 別のrepoには、commit SHAを固定してコンテナへ組み込み、更新PRを自動で作る構成がある。そこのテストと手順書も直す必要がある。
- GitHubのrepo改名は旧URLへ転送されるが、コマンド名は転送されない。

## 実測の範囲

- `slack api --help`と`slack --help`（手元のv4.9.0）。最新のv4.13.0は手元で動かしていない。
- `slack api api.test --no-auth`は`{"ok":true,"args":{}}`を返した。
- `api.go`は`main`の現物から`multipart`、`cursor`、`paginate`、`file`などの語で検索した。呼び出し先のパッケージまでは読んでいない。
- slamyは`--help`とソースの配置を確認した（`main`の`afda11c`）。
- 他repoの利用箇所はGitHubのコード検索で見た。結果には上限があり、索引の対象外は出てこないので、全件ではない。

## 未確認のこと

- v4.13.0で`slack api`のファイル送信やページングが変わっていないか。上記の`api.go`は現物の`main`だが、実機では試していない。
- 認証つきの`slack api`の動作。実トークンを使う試験はしていない。
- `files.upload`が現在も応答するか。
- `search.messages`の停止時期。

## 出典

確認日はすべて2026-11-08。

- [slack api - Slack Developer Docs](https://docs.slack.dev/tools/slack-cli/reference/commands/slack_api/)
- [Release: Slack CLI v4.1.0](https://docs.slack.dev/changelog/2026/05/19/slack-cli/)。原文: "We've added a `slack api <method>` command, which allows you to call any API method directly from the Slack CLI."
- [files.upload](https://docs.slack.dev/reference/methods/files.upload/)。原文: "It will stop functioning and be officially sunset on November 12, 2025."
- [search.messages](https://docs.slack.dev/reference/methods/search.messages/)。原文: "This is a legacy method"
- [slackapi/slack-cli](https://github.com/slackapi/slack-cli)の`cmd/api/api.go`

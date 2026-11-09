# slamy — Slack API クライアント & CLI

[English](README.md) | **日本語**

Slack の閲覧・検索・投稿に対応する Slack API クライアント兼 CLI ツールです。

## 機能

- **CLI** — Slack 操作をターミナルから直接実行
- **TypeScript API クライアント** — Node.js アプリケーションから `SlamyClient` を利用
- **Socket Mode イベント** — `SlamyEvents` で Slack イベントを購読
- **チャンネル** — チャンネル一覧、メッセージ履歴取得
- **メッセージ** — メッセージ投稿、スレッド返信
- **ユーザー** — ワークスペースメンバー一覧、プロフィール表示
- **リアクション** — 絵文字リアクション追加
- **検索** — Slack クエリ構文でメッセージ横断検索
- **複数出力フォーマット** — テキスト、JSON、TSV

## Slack 公式 CLI と slamy の役割

Slack 公式の [`slack` CLI](https://docs.slack.dev/tools/slack-cli/) は、アプリの
create/link/install/uninstall、Manifest、ローカル実行、デプロイ、activity、ログ、ドキュメント、
任意の Web API 呼び出しなど、Slack アプリ開発を担当します。対応する公式コマンドでは、`--team`
による明示的なワークスペース選択も行えます。slamy の目標範囲は、人やエージェントが使う
タスク指向の操作です。TypeScript CLIのすべてのSlack APIコマンドは、明示・default選択に同じ
workspace resolverとcredential検証経路を使用し、安定した出力を提供します。Slack URLを受け取る
コマンドではpermalink由来のtargetも解決します。

slamyは公式 CLI を子プロセスとして呼び出さず、その非公開 credential ファイルも読みません。
公開 Slack API を直接利用するため、両ツールは独立して併用できます。責務分担表、機能追加の
判断基準、将来の廃止基準は [ADR 001](docs/adr/001-official-slack-cli-boundary.md) を参照してください。

## アーキテクチャ

TypeScriptをslamyのCLIとライブラリに共通する単一マスター実装とします。現在のGo/TypeScript
実装から、workspace、credential、target、Slack adapter、command、output、event、CLI、libraryの
境界を持つ単一packageのモジュール構造へ段階的に移行します。この目標構造はまだ完全には
実装されていません。

component/data-flow図、import規則、公開API互換方針、Go削除gateは
[ADR 002](docs/adr/002-typescript-module-architecture.md)を参照してください。

## インストール

### TypeScript API / CLI（ソースから実行）

コマンド名は`slack-api-cli`です。`slamy`も別名として使えます。この文書の例は`slack-api-cli`で書いています。

slamyはnpmへ公開していません。リポジトリをcloneし、CLIをソースから実行します（Node.js 25以上）。

```bash
git clone https://github.com/tackeyy/slack-api-cli.git
cd slack-api-cli
npm install
npx tsx src/cli/index.ts --help
```

`slack-api-cli`と`slamy`をPATHに追加するには、次を実行します。

```bash
npm run build
npm link
```

`package.json`の`bin`は`dist/cli/index.js`を指すため、ビルド後にlinkします。
`slack-api-cli`の追加前にlinkしていた場合も、この手順で既存のlinkを更新できます。

### Homebrew

```bash
brew install tackeyy/tap/slamy
```

### Go

```bash
go install github.com/tackeyy/slamy@latest
```

### ソースから Go CLI をビルド

```bash
git clone https://github.com/tackeyy/slack-api-cli.git
cd slack-api-cli/go-src
go build -o ../slamy .
```

## クイックスタート

### 1. Slack App を作成

1. [Slack API](https://api.slack.com/apps) にアクセスし、**Create New App** をクリック
2. **From scratch** を選択し、アプリ名（例: `slamy`）を入力
3. インストール先のワークスペースを選択

### 2. User Token Scopes を設定

**OAuth & Permissions** > **Scopes** > **User Token Scopes** に以下を追加:

| Scope | 用途 |
|---|---|
| `channels:history` | パブリックチャンネルのメッセージ閲覧 |
| `channels:read` | チャンネル情報の取得 |
| `channels:write` | パブリックチャンネルの作成 |
| `channels:write.topic` | パブリックチャンネルのtopic・説明設定 |
| `chat:write` | メッセージ送信（自分として投稿） |
| `files:read` | チャンネル内で共有されたファイルのダウンロード |
| `groups:history` | プライベートチャンネルのメッセージ閲覧 |
| `groups:read` | プライベートチャンネル情報の取得 |
| `groups:write` | プライベートチャンネルの作成 |
| `groups:write.topic` | プライベートチャンネルのtopic・説明設定 |
| `reactions:write` | 絵文字リアクションの追加 |
| `search:read` | メッセージ検索 |
| `users:read` | ユーザー情報の取得 |
| `users:read.email` | メールアドレスの閲覧 |
| `users.profile:read` | ユーザープロフィールの閲覧 |
| `users.profile:write` | ユーザープロフィールの更新 |
| `team:read` | ワークスペース（team）情報の取得 |

### 3. インストールと workspace の登録

ワークスペースにアプリをインストールし、slamy に workspace を登録する:

```bash
slack-api-cli workspace add --team-id T01234567 --alias myworkspace \
  --domain myworkspace.slack.com --name "My Workspace" \
  --user-token-env SLACK_USER_TOKEN
```

オプションの詳細は `slack-api-cli workspace --help` を参照してください。

### 4. 認証セッションの開始

パスワードマネージャーから stdin にトークンを渡してメモリ内のローカルセッションを開始する:

```bash
op read 'op://<vault>/<item>/<field>' |
  slack-api-cli --workspace myworkspace auth session start
```

トークンをコマンドライン引数として渡すことはできません。

### 5. 実行

```bash
slack-api-cli channels list
```

### レガシー: 環境変数による認証（非推奨）

`SLACK_USER_TOKEN` または `SLACK_BOT_TOKEN` による直接認証は後方互換のためにサポートされていますが、**非推奨**です。workspace registry と `auth session start` の利用を推奨します。

```bash
# 非推奨 — 上記の workspace registry + auth session start を使用してください
export SLACK_USER_TOKEN=xoxp-your-user-token
```

### 任意: セッション TTL とフォアグラウンドモード

既定の TTL は 24 時間です。延長またはフォアグラウンドで動かす場合:

```bash
# 7日間が明示指定できる上限値
op read 'op://<vault>/<item>/<field>' |
  slack-api-cli --workspace wedgeai auth session start --ttl 7d

# Terminal、launchd等のsupervisor自身にbrokerを保持させる場合
op read 'op://<vault>/<item>/<field>' |
  slack-api-cli --workspace wedgeai auth session start --ttl 7d --foreground

slack-api-cli --workspace wedgeai auth session status
slack-api-cli --workspace wedgeai auth session revoke
```

バックグラウンドのbrokerはSlackトークンをメモリ内に保持し、canonical Team IDを検証して、
owner限定のUnix socketからslamyが許可したSlack操作だけを受け付けます。後続のCLIプロセスへ
Slackトークン自体は返しません。ただし、同じmacOSユーザーとして動く別プロセスは、期限切れ
またはrevokeまでbrokerを利用できます。通常は既定の24時間を使用し、必要な場合だけ7日間を
指定してください。ローカルrevokeはSlack OAuth token自体をrotationしません。制御と残余リスクは
[security record](docs/reports/local-auth-session-security.md)を参照してください。
foreground modeも同じ制御を使いますが、brokerは現在プロセスに接続されたままになります。
セッション期間中は、そのTerminalまたはsupervisorプロセスを動かし続けてください。

## User Token vs Bot Token

Slack App は 2 種類のトークンを発行できます。用途に応じて使い分けます。

| | Bot Token (`xoxb-`) | User Token (`xoxp-`) |
|---|---|---|
| メッセージ検索 (`search:read`) | **利用不可** | 利用可 |
| トークン管理 | 検索が必要なら 2 トークン必要 | 1 トークンで完結 |
| メッセージ投稿 | アプリ名（bot）として投稿 | ユーザー本人として投稿 |
| プライベートチャンネル | bot を招待する必要あり | ユーザーと同じチャンネルにアクセス |

### User Token を使うケース: ユーザーの代理として動作する場合

slamyは、特定のユーザーに代わって Slack の閲覧・検索・投稿を行うアプリケーションをサポートします。このユースケースでは、User Token が自然な選択です:

1. **検索に必須** — `search:read` は User Token 専用のスコープ。Bot Token ではメッセージ検索ができない
2. **トークン 1 つで完結** — 2 つのトークンを管理して操作ごとに使い分ける必要がない
3. **ユーザーコンテキスト** — エージェントの投稿がユーザー本人として表示され、誰の操作か明確
4. **チャンネルアクセス** — bot を個別に招待せずとも、ユーザーと同じチャンネルにアクセスできる

### Bot Token を使うケース: bot を作る場合

Slack bot（パーソナルアシスタントではなく）を作る場合は Bot Token が適切です:

- bot 独自のアイデンティティを持ち、アプリ名で投稿する
- 複数ユーザーが bot とやり取りする — 特定ユーザーとして動作すべきでない
- bot を招待したチャンネルだけにアクセスを制限したい
- メッセージ検索が不要、または制約を許容できる

## コマンド

### `channels list` — チャンネル一覧

```bash
slack-api-cli channels list [--limit <number>] [--include-archived] [--json] [--plain]
```

| フラグ | 必須 | 説明 |
|---|---|---|
| `--limit <number>` | No | 取得するチャンネル数の上限 |
| `--include-archived` | No | アーカイブ済みチャンネルを含める |
| `--json` | No | JSON 形式で出力 |
| `--plain` | No | TSV 形式で出力 |

### `channels create` — チャンネル作成・整合

```bash
slack-api-cli channels create 01-engineering \
  --workspace wedgeai \
  --topic "AI・ソフトウェア開発" \
  --purpose "AI・ソフトウェア開発と技術判断を共有します。" \
  --dry-run
```

`--workspace`または`SLAMY_DEFAULT_WORKSPACE`でworkspaceを選択し、設定済みcredentialのTeam IDを
照合してから実行します。同名チャンネルが存在する場合は
重複作成せず、topicとpurposeを指定値へ整えます。`--private`を付けるとprivate channelを対象とします。
`--dry-run`はcredentialを読まず、Slack APIも呼ばずに予定操作だけを返します。通常実行では作成・設定後に
`conversations.info`で再取得し、名前、公開範囲、topic、purposeが一致した場合だけ成功とします。

### グローバルオプション

slamy には Go 版と TypeScript 版の CLI があります。利用できるルートオプションは、インストールした CLI によって異なります。

Go CLI（`go install` またはソースからビルド）:

| フラグ | 説明 |
|---|---|
| `--workspace <alias>` | この実行で使用する Slack ワークスペースエイリアスを指定 |
| `--json` | JSON 形式で出力 |
| `--plain` | TSV 形式で出力 |

TypeScript CLI:

| フラグ | 説明 |
|---|---|
| `--workspace <selector>` | alias、Team ID、または登録済みの現在・過去の完全修飾Slack domainでworkspaceを選択 |
| `--json` | JSON 形式で出力 |
| `--plain` | TSV 形式で出力 |
| `--utc` | タイムスタンプを UTC で表示（デフォルトはローカル TZ） |
| `--tz <iana>` | 指定 IANA タイムゾーンで表示（例: `Asia/Tokyo`） |

TypeScript CLIでは、Slack APIを呼ばないworkspace registry管理も利用できます。

```bash
slack-api-cli workspace list
slack-api-cli workspace add --team-id T01234567 --alias primary \
  --domain primary.slack.com --name "Primary" \
  --user-token-env SLAMY_WORKSPACE_PRIMARY_USER_TOKEN --default
slack-api-cli workspace show primary
slack-api-cli workspace default primary
slack-api-cli workspace default --clear
slack-api-cli workspace remove primary
```

これらのコマンドはSlackへ接続せず、token値を引数として受け取りません。Slack APIを呼ぶすべての
TypeScript CLIコマンドは、root selectorをこのregistryで解決し、API client作成前に設定済みの全
credentialを`auth.test`で検証します。TypeScript libraryでは、atomic credential-set resolver、
厳格なpermalink Target resolver、名前付きworkspace-aware Slack操作も利用できます。

### `channels history` — チャンネルのメッセージ履歴

```bash
slack-api-cli channels history <channel_or_url> [--limit <n>] [--oldest <ts>] [--latest <ts>] [--resolve-names]
```

| フラグ | 必須 | 説明 |
|---|---|---|
| `<channel_or_url>` | Yes | チャンネル ID または Slack permalink URL |
| `--limit <n>` | No | メッセージ数（デフォルト: 20） |
| `--oldest <ts>` | No | この Unix timestamp 以降のメッセージのみ |
| `--latest <ts>` | No | この Unix timestamp 以前のメッセージのみ |
| `--resolve-names` | No | `user_id` / `bot_id` を実名表示 |

### `messages post` — メッセージ投稿

```bash
slack-api-cli messages post <channel_id> --text <message> [--as-user] [--thread-ts <ts>]
```

`--thread-ts <ts>` を指定すると、そのスレッドへの返信として投稿します（形式は `1700000000.000100`。不正な値は Slack を呼ばずにエラー）。

### `messages reply` — スレッド返信

```bash
slack-api-cli messages reply <channel_or_url> [thread_ts] --text <message> [--broadcast]
```

`<channel_or_url>` は「channel ID + thread_ts」または Slack permalink URL の 1 引数のいずれも受け付けます。

### `messages update` / `messages delete` — メッセージ編集

```bash
slack-api-cli messages update <channel_or_url> [ts] --text <new_text>
slack-api-cli messages delete <channel_or_url> [ts]
```

### `messages schedule` — 予約投稿

```bash
slack-api-cli messages schedule <channel_id> --text <message> --at <datetime>
```

`<datetime>` は Unix timestamp または ISO 8601 形式（例: `2026-02-24T09:00+09:00`）。

### `threads replies` — スレッド返信を取得

```bash
slack-api-cli threads replies <channel_or_url> [thread_ts] [--limit <n>] [--resolve-names]
```

`<channel_or_url>` は「channel ID + thread_ts」または Slack permalink URL の 1 引数のいずれも受け付けます。

### `channels members` — チャンネルメンバー一覧

```bash
slack-api-cli channels members <channel_or_url> [--resolve-names]
```

`<channel_or_url>` は channel ID または Slack permalink URL を受け付けます。`--resolve-names` で `user_id` を実名表示。

### `users list` / `users profile` / `users set-real-name` / `users set-display-name`

```bash
slack-api-cli users list [--include-deactivated] [--include-bots]
slack-api-cli users profile <user_id>
slack-api-cli users set-real-name <user_id> <real_name>
slack-api-cli users set-display-name <user_id> <display_name>
```

`set-display-name` も `users.profile.set` を呼びます: user token が必要で、bot token だけの構成と local session では拒否されます。表示名は 80 文字までです。

### `assistant set-status` — AI Assistant スレッドのステータス設定

```bash
slack-api-cli assistant set-status --channel <id> --thread <ts> --status <text> [--loading-message <text...>]
```

AI Assistant スレッドの typing indicator を設定します。CI/シェルスクリプト用には `--plain` で機械可読 TSV (`ok\t<channel>\t<thread>`) が利用できます。

### `reactions get` — 特定メッセージの reactions を取得

```bash
slack-api-cli reactions get <channel_or_url> [timestamp] [--resolve-names]
```

絵文字ごとの reaction 数と reaction したユーザーを返します。`reactions add` 前に既存リアクションを確認するのに便利です。

### `reactions list` — ユーザーの reaction 履歴

```bash
slack-api-cli reactions list [--user <user_id>] [--limit <n>] [--count] [--resolve-names]
```

`--resolve-names` は `channel_id` を channel 名に解決します (`#C0123ABCDE` ではなく `#general`)。

注意: `reactions list`（ユーザーの reaction 履歴）と `reactions get`（メッセージへの reactions）は別の API です。

### `reactions add` / `reactions remove` — リアクション追加/削除

```bash
slack-api-cli reactions add <channel_or_url> [timestamp] --name <emoji>
slack-api-cli reactions remove <channel_or_url> [timestamp] --name <emoji>
```

### `search messages` — メッセージ検索

```bash
slack-api-cli search messages <query> [--count <n>] [--page <n>] [--sort <field>] [--sort-dir <dir>] [--resolve-names]
```

| フラグ | 必須 | 説明 |
|---|---|---|
| `<query>` | Yes | 検索クエリ（`in:#channel`、`from:@user` 等の Slack 修飾子対応） |
| `--count <n>` | No | 1 ページあたりの結果数（デフォルト: 20） |
| `--page <n>` | No | ページ番号（デフォルト: 1） |
| `--sort <field>` | No | `timestamp` または `score`（デフォルト: timestamp） |
| `--sort-dir <dir>` | No | `asc` または `desc`（デフォルト: desc） |
| `--resolve-names` | No | `user_id` を実名表示 |

### `auth test` — 認証テスト

```bash
slack-api-cli auth test [--json] [--plain]
```

### `team info` — ワークスペース情報の取得

```bash
slack-api-cli team info [--json] [--plain]
```

ワークスペースのドメイン・`email_domain`・Enterprise 情報を返す。`email_domain` は SSO のドメイン不一致の診断に役立つ。`team:read` スコープが必要。なお、SSO の必須化設定は Slack API では取得**できない**。

## 設定

### 環境変数

| 変数 | 必須 | 説明 |
|---|---|---|
| `SLAMY_CONFIG_FILE` | No | TypeScript workspace registryのpathを上書き。既定は`$XDG_CONFIG_HOME/slamy/workspaces.json`または`~/.config/slamy/workspaces.json` |
| `SLAMY_WORKSPACE_<ALIAS>_USER_TOKEN` | 対応するエイリアスの選択時 | ワークスペースエイリアス用の User OAuth Token。エイリアスを大文字化し、ハイフンをアンダースコアへ変換 |
| `SLAMY_DEFAULT_WORKSPACE` | No | `--workspace`を省略した場合に使用する登録済みworkspace selector（alias、Team ID、または現在・過去の完全修飾Slack domain） |
| `SLACK_USER_TOKEN` | 従来の単一ワークスペース利用時 | 後方互換用 Slack User OAuth Token (`xoxp-...`)。明示・defaultのどちらのworkspace selectorも設定されない場合のみ使用 |
| `SLACK_BOT_TOKEN` | いずれか | Slack Bot OAuth Token (`xoxb-...`) — 書き込み操作と `reactions get` で使用 |
| `SLAMY_TZ` | No | `engagement` コマンド用の IANA タイムゾーン（デフォルト: `Asia/Tokyo`） |
| `SLACK_TEAM_ID` | No | Slack Team ID（ワークスペース固有の操作用） |

従来モードで `SLACK_USER_TOKEN` / `SLACK_BOT_TOKEN` の両方を設定すると、操作に応じて適切なトークンが自動選択されます。

### 複数ワークスペース

TypeScript workspace registryではSlack Team IDを正規識別子とします。alias、現在domain、過去domain、
表示名、default状態、credential referenceは変更可能な属性です。referenceは検証済みprovider IDと
opaqueなreference名を持ちます。組み込みproviderは環境変数名を解決し、custom providerはworkspace
recordを変更せずKeychainやOAuthのreferenceを解決できます。registryにはreference名だけを保存し、
token値は保存しません。破損JSON、未知field、Team ID・alias・domainの重複、参照先のないdefault、
symlink、group/otherから読めるfileを拒否し、更新時はdocument全体をatomicに置き換えます。

上記の`workspace list/add/remove/show/default`を利用でき、`--json`と`--plain`にも対応します。
POSIXでは専用config directoryを`0700`、registry fileを`0600`で作成します。

libraryから`createCredentialResolver()`を使うと、一つの`WorkspaceRecord`に設定されたUser/Bot
referenceを一つのsetとして解決・検証できます。別token種別への代替、検証途中の部分set返却、
cross-workspaceのUser/Bot混在、registry workspaceからlegacy global tokenへのfallbackは行いません。
raw token値は文字列化、JSON、inspection、provider error、verification errorでredactされます。
operation終了時は返却setの`destroy()`を呼び出してください。set内の全credentialを冪等に破棄します。
custom providerとverifierはinterface上raw tokenを扱う必要があるため、trusted componentです。実装を
検証し、適切に隔離してください。

Slackの`auth.test`が証明するのはidentityとTeam IDであり、操作scopeではありません。Userの
`search:read`などはrequirement metadataとして保持できます。workspace-aware adapterはtransport前に
この宣言契約を確認し、Slackから返る`missing_scope`をsecret-safeなplatform errorへ正規化しますが、
宣言自体はtokenへscopeが付与済みであることの証明ではありません。

library callerは、検証済みcredential setから明示contextを一つ作り、すべての名前付き操作へ渡します。

```ts
import {
  createSlackWorkspaceContext,
  createWorkspaceSlackAdapter,
} from "slamy";

const context = createSlackWorkspaceContext({
  teamId: workspace.teamId,
  credentials,
});
const slack = createWorkspaceSlackAdapter();

try {
  await slack.postMessage(context, { channelId: "C0123ABC", text: "hello" });
} finally {
  credentials.destroy();
}
```

packageが公開するのはslamy所有の名前付きDTOだけで、汎用`apiCall`は公開しません。policyは操作ごとに
UserまたはBotのcredential種別と必要scope metadataを固定します。呼び出しごとにcacheしないSDK clientを
使い、自動retryは無効です。rate limitは`retryAfterSeconds`を持つ`SlackAdapterError`として上位へ返します。
cursorは`response_metadata.next_cursor`だけを追跡し、反復・不正cursorを拒否して上限を設けます。
diagnosticsにはlocal request ID、method、Team ID、credential種別、結果、正規化済みerror codeだけを含めます。
local request IDはslamy内の相関IDであり、Slackの`x-slack-req-id`ではありません。
organization-wide token対応methodでは、policyが明示contextのTeam IDをSlack仕様の`team`または
`team_id`引数へ写像します。

libraryから`createTargetResolver()`へ`WorkspaceCatalog`を注入すると、Slackの`archives`
permalink（`thread_ts` / `cid`を含む）、`app.slack.com/client`のchannel URLと観測済みthread URL、
および厳格な従来channel IDと任意のmessage/thread timestampを解決できます。返却するimmutableな
Targetはworkspace、channel、message、threadの根拠を一つにまとめます。workspaceは、明示指定、
Target Team ID、登録済みの現在または過去hostname、URLを伴わない入力に限るregistry defaultの順で
fail-closedに選択します。競合または未登録のURL根拠をdefaultへfallbackしません。

Slack Connect channelの所有workspaceは`unknown`として返します。曖昧でない根拠から実行workspaceを
一つ選択できても、接続先のどのworkspaceがchannelを所有するかは推測しません。候補Team IDが複数ある
場合とEnterprise IDだけの`app.slack.com` URLは明示workspaceが必要です。parserとworkspace選択は
credentialへアクセスせず、Slack APIも呼びません。

以下の環境変数alias方式は従来のGo CLI契約です。v2中はread-only互換を維持し、削除は早くても
v3.0.0以降です。旧環境変数だけではSlack Team IDを証明できないため、自動importしません。
詳細は[workspace registry移行ガイド](docs/migrations/workspace-registry-v2.md)を参照してください。

ワークスペースエイリアスはローカルの識別子です。Slack 上のワークスペース名、ドメイン、Team ID とは独立しており、slamy がエイリアスを自動検出・照合することはありません。エイリアスは 1〜63 文字で、正規表現 `^[a-z0-9]+(?:-[a-z0-9]+)*$` に一致する必要があります（例: `primary`、`operations`、`project-a`）。

エイリアスごとに User OAuth Token を設定します。環境変数名は、エイリアスを大文字化し、ハイフンをアンダースコアへ変換して作成します。

```bash
export SLAMY_DEFAULT_WORKSPACE=primary
export SLAMY_WORKSPACE_PRIMARY_USER_TOKEN='<user-token>'
export SLAMY_WORKSPACE_OPERATIONS_USER_TOKEN='<user-token>'
export SLAMY_WORKSPACE_PROJECT_A_USER_TOKEN='<user-token>'
```

Slack APIを呼ぶすべてのTypeScript CLIコマンドでは、接続先を次の順序で選択します。

1. ルートの`--workspace <selector>`（registryのalias、Team ID、または現在・過去の完全修飾Slack domain）
2. `SLAMY_DEFAULT_WORKSPACE`
3. 上記2つがどちらも未設定の場合のみ、後方互換用の`SLACK_USER_TOKEN` / `SLACK_BOT_TOKEN`

選択用の `SLAMY_WORKSPACE` 環境変数はありません。明示指定には `--workspace` を使用してください。

```bash
# デフォルトエイリアス primary を使用
slack-api-cli channels list

# 明示指定はデフォルトより優先
slack-api-cli --workspace operations channels list
slack-api-cli --workspace project-a auth test
```

registry選択はfail-closedです。選択したworkspaceに設定されたcredential referenceだけを解決し、
`auth.test`のTeam IDをregistryと照合します。credential欠落、identity不一致、曖昧・未登録の選択、
workspaceをまたぐUser/Bot credentialではAPI clientを作成しません。registry selectorがある場合、
`SLACK_USER_TOKEN`、`SLACK_BOT_TOKEN`、別workspaceへはfallbackしません。

`channel_or_url`を受け取るコマンドは、API client作成前に対応するSlack permalinkを解決します。
permalinkのhostnameまたはTeam IDは、登録済みの過去domainを含め、選択workspaceと一致する必要が
あります。競合、未登録、Slack以外のURLではAPIを呼ばず失敗します。明示/default selectorがない
permalinkはlegacy global credentialではなく登録先workspaceを使用します。selectorなしの通常channel
IDだけは従来の単一workspace動作を維持します。

既存の単一ワークスペース設定には後方互換性があります。`SLACK_USER_TOKEN`または
`SLACK_BOT_TOKEN`をそのまま設定し、`--workspace`と`SLAMY_DEFAULT_WORKSPACE`の両方を未設定にします。
移行するには、token環境変数をregistry workspaceのcredential referenceへ追加し、
`SLAMY_DEFAULT_WORKSPACE`をそのworkspaceの有効なselectorに設定します。新しい設定を確認した後で
legacy変数を削除してください。

すべてのトークンを secret として扱ってください。リポジトリへコミットしたり、コマンドライン引数で渡したり、ログ・標準出力・標準エラー出力・JSON へ出力したりしないでください。保護された環境変数または secret 管理機能から渡してください。

## 出力フォーマット

### テキスト（デフォルト）

```
#general                       C01234ABCDE  [42 members]
#random                        C01234FGHIJ (private)  [15 members]
```

### JSON (`--json`)

```json
[
  {
    "id": "C01234ABCDE",
    "name": "general",
    "num_members": 42,
    "is_private": false
  }
]
```

### TSV (`--plain`)

```
C01234ABCDE	general	42	public
C01234FGHIJ	random	15	private
```

## TypeScript API

TypeScript パッケージは、Slack Web API 操作用の `SlamyClient` と Socket Mode イベント用の `SlamyEvents` を公開しています。Node.js 25 以上が必要です。

```ts
import { SlamyClient } from "slamy";

const client = new SlamyClient({ userToken: process.env.SLACK_USER_TOKEN });
const channels = await client.listChannels();
```

トークンは保護された環境変数またはシークレット管理機能から渡してください。完全な API は公開されている TypeScript の型定義を参照してください。

## 開発

```bash
# Go CLI のビルドとテスト
cd go-src
go build -o ../slamy .
go test -race ./...
go test -cover ./...

# TypeScript API / CLI のビルドとテスト
cd ..
npm run build
npm test
```

開発環境のセットアップやコーディング規約は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。
テストの詳細ガイドは [docs/TESTING.md](docs/TESTING.md) を参照してください。

## コントリビューション

コントリビューション歓迎です！Pull Request を送る前に [Contributing Guide](CONTRIBUTING.md) をお読みください。

すべてのコントリビューターに [行動規範](CODE_OF_CONDUCT.md) の遵守をお願いしています。

## ライセンス

MIT

## リンク

- [GitHub リポジトリ](https://github.com/tackeyy/slack-api-cli)
- [Slack API ドキュメント](https://api.slack.com/docs)

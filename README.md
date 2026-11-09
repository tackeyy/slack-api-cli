# slamy — Slack API client & CLI

**English** | [日本語](README.ja.md)

A Slack API client and standalone CLI for reading, searching, and posting to Slack.

## Channel sharing metadata

```sh
slack-api-cli --workspace example --json channels info C012AB3CD
slack-api-cli --json channels info https://example.slack.com/archives/C012AB3CD/p1700000000000001
```

Uses the shared workspace/permalink resolver and returns only channel identity, privacy/sharing
flags, shared/connected workspace IDs and the host/context IDs. It never returns messages, topic
or purpose content. Missing API fields remain omitted in JSON and appear as `unknown` in human
and TSV output; they do not imply an unshared or public channel. Host IDs can identify a workspace
(`T...`) or Enterprise organization (`E...`), so a host ID alone is not an external workspace ID.

The command reads the documented
[`conversations.info`](https://docs.slack.dev/reference/methods/conversations.info/) metadata.
Existing token permissions and channel membership apply; it does not request new permissions.

## Features

- **CLI** — run Slack operations directly from the terminal
- **TypeScript API client** — use `SlamyClient` from Node.js applications
- **Socket Mode events** — subscribe to Slack events with `SlamyEvents`
- **Channels** — list channels, retrieve message history
- **Messages** — post messages, reply to threads
- **Users** — list workspace members, view profiles
- **Reactions** — add emoji reactions to messages
- **Search** — search messages across channels with Slack query syntax
- **Multiple output formats** — human-readable text, JSON, and TSV

## Official Slack CLI and slamy

The official [`slack` CLI](https://docs.slack.dev/tools/slack-cli/) owns Slack app development:
create/link/install/uninstall, manifests, local run, deployment, activity, logs, documentation, and
ad hoc Web API calls. It can also select a team explicitly for its own commands with `--team` where
supported. slamy's target scope is task-oriented operations for humans and agents. Every Slack API
command in the TypeScript CLI uses the same explicit/default workspace selector, credential
verification path, and stable output conventions. Commands that accept Slack URLs also resolve
their target from the permalink.

slamy does not invoke the official CLI or read its private credential files. It uses documented
Slack APIs directly, so both tools can be installed and used independently. See
[ADR 001](docs/adr/001-official-slack-cli-boundary.md) for the responsibility matrix, feature
acceptance rules, and deprecation criteria.

## Architecture

TypeScript is the target single implementation for both the slamy CLI and library. The repository
is migrating incrementally from the current Go/TypeScript implementations to a single-package
modular architecture with explicit workspace, credential, target, Slack adapter, command, output,
event, CLI, and library boundaries. This target structure is not yet fully implemented.

See [ADR 002](docs/adr/002-typescript-module-architecture.md) for the component and data-flow
diagrams, import rules, public API compatibility policy, and Go removal gates.

## Installation

### TypeScript API and CLI (from source)

The command is `slack-api-cli`. `slamy` remains available as an alias, and the examples in this document use `slack-api-cli`.
If you ran `npm link` before this name was added, run `npm link` again to put `slack-api-cli` on your PATH.

slamy is not published to npm. Clone the repository and run the CLI from source
(Node.js 25 or later):

```bash
git clone https://github.com/tackeyy/slack-api-cli.git
cd slack-api-cli
npm install
npx tsx src/cli/index.ts --help
```

### Homebrew

```bash
brew install tackeyy/tap/slamy
```

### Go

```bash
go install github.com/tackeyy/slamy@latest
```

### Build the Go CLI from source

```bash
git clone https://github.com/tackeyy/slack-api-cli.git
cd slack-api-cli/go-src
go build -o ../slamy .
```

## Quick Start

### 1. Create a Slack App

1. Go to [Slack API](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**, name your app (e.g., `slamy`)
3. Select the workspace to install to

### 2. Configure User Token Scopes

In **OAuth & Permissions** > **Scopes** > **User Token Scopes**, add:

| Scope | Purpose |
|---|---|
| `channels:history` | View messages in public channels |
| `channels:read` | View basic channel info |
| `channels:write` | Create public channels |
| `channels:write.topic` | Set public channel topics and descriptions |
| `chat:write` | Send messages (as yourself) |
| `files:read` | Download files shared in channels |
| `groups:history` | View messages in private channels |
| `groups:read` | View basic private channel info |
| `groups:write` | Create private channels |
| `groups:write.topic` | Set private channel topics and descriptions |
| `reactions:write` | Add emoji reactions |
| `search:read` | Search messages |
| `users:read` | View users and their basic info |
| `users:read.email` | View email addresses |
| `users.profile:read` | View user profiles |
| `users.profile:write` | Update user profiles |
| `team:read` | View workspace (team) info |

### 3. Install and register the workspace

Install the app to your workspace, then register it with slamy:

```bash
slack-api-cli workspace add --team-id T01234567 --alias myworkspace \
  --domain myworkspace.slack.com --name "My Workspace" \
  --user-token-env SLACK_USER_TOKEN
```

See `slack-api-cli workspace --help` for all options.

### 4. Start an authentication session

Pipe your token from a password manager to start an in-memory local session:

```bash
op read 'op://<vault>/<item>/<field>' |
  slack-api-cli --workspace myworkspace auth session start
```

Tokens are not accepted as command arguments.

### 5. Run

```bash
slack-api-cli channels list
```

### Legacy: environment variable authentication (deprecated)

Setting `SLACK_USER_TOKEN` or `SLACK_BOT_TOKEN` directly is supported for single-workspace
backwards compatibility but is **deprecated**. Use the workspace registry and
`auth session start` instead.

```bash
# Deprecated — use workspace registry + auth session start above
export SLACK_USER_TOKEN=xoxp-your-user-token
```

### Optional: named authentication profiles

Keep multiple apps on the same workspace without replacing its unnamed credentials:

```bash
slack-api-cli workspace profile add myworkspace app-a --user-token-env APP_A_USER_TOKEN
slack-api-cli workspace profile add myworkspace app-b --bot-token-env APP_B_BOT_TOKEN
slack-api-cli workspace profile list myworkspace
# Pipe the app-a token from your password manager into this command:
slack-api-cli --workspace myworkspace --profile app-a auth session start
slack-api-cli --workspace myworkspace --profile app-a auth session status
slack-api-cli --workspace myworkspace --profile app-b auth test
slack-api-cli --workspace myworkspace --profile app-a auth session revoke
slack-api-cli workspace profile remove myworkspace app-a
```

Supply session tokens through stdin from your password manager, as above; never put token
values in arguments. Profile registration stores environment variable names only. Removing a
profile changes the registry only; revoke its session before removal if you want it stopped.

`--profile <name>` selects credentials after workspace selection: `--workspace`, then
`SLAMY_DEFAULT_WORKSPACE`, then the registry default. A permalink selects its registered workspace
when no explicit or environment selector is present. A registered workspace and an existing profile
are required; missing selections fail without using unnamed credentials or legacy tokens.
Channel management commands (`channels info/create/invite/invite-shared/kick/rename`) currently
reject `--profile` rather than using unnamed credentials.
There is no profile environment variable. Names must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`,
be 1–32 characters, and differ from the reserved name `default`. Conflicting repeated flags fail.

Profiles replace the complete credential reference set; they do not merge with unnamed credentials.
Their sessions live at `sessions/<teamId>/profiles/<profile>/<kind>/`, with sockets named
`<teamId>-<kind>-<profile>.sock` in the runtime directory. Start, status, revoke, and expiry affect
only the selected profile. Public session output includes `profile` only when selected;
TSV output appends it as the last column. Omitting `--profile` retains the existing paths and output.

### Optional: session TTL and foreground mode

The default session TTL is 24 hours. To extend or keep the broker in the foreground:

```bash
# Seven days is the explicit maximum.
op read 'op://<vault>/<item>/<field>' |
  slack-api-cli --workspace wedgeai auth session start --ttl 7d

# Keep the broker attached to the current process (Terminal, launchd, etc.).
op read 'op://<vault>/<item>/<field>' |
  slack-api-cli --workspace wedgeai auth session start --ttl 7d --foreground

slack-api-cli --workspace wedgeai auth session status
slack-api-cli --workspace wedgeai auth session revoke
```

The detached broker keeps the Slack token in memory, verifies the canonical Team ID, and exposes
only slamy's allowlisted Slack operations over an owner-only Unix socket. It does not return the
Slack token to later CLI processes. A process already running as the same macOS user can still use
the broker until expiry or revoke, so prefer the 24-hour default and use seven days only when the
longer window is necessary. Local revoke does not rotate the Slack OAuth token. See the
[security record](docs/reports/local-auth-session-security.md) for controls and residual risks.
Foreground mode uses the same controls but keeps the broker attached to the current process; keep
that Terminal or supervisor process running for the session lifetime.

## User Token vs Bot Token

Slack Apps can issue two types of tokens. Which one to use depends on your use case.

| | Bot Token (`xoxb-`) | User Token (`xoxp-`) |
|---|---|---|
| Message search (`search:read`) | **Not available** | Available |
| Token management | Need 2 tokens if search is required | 1 token for everything |
| Message posting | Posts as "app" (bot name) | Posts as the user |
| Private channel access | Must be invited to channel | Access same channels as the user |

### Use User Token when: acting on behalf of a user

slamy supports applications that read, search, and post to Slack on behalf of a specific user. In this use case, User Token is the natural choice:

1. **Search requires it** — `search:read` is a User Token-only scope. Bot Tokens simply cannot search messages
2. **Single token** — no need to manage two tokens and worry about which operation uses which
3. **User context** — messages posted by the agent appear as the user, making it clear who is responsible
4. **Channel access** — the agent can access the same channels as the user without manual invitation

### Use Bot Token when: building a bot

Bot Token is the right choice if you are building a Slack bot (not a personal assistant):

- The bot has its own identity and posts as "app name", not as a specific user
- Multiple users interact with the bot — it shouldn't act as any single user
- You want to control access by inviting the bot only to specific channels
- You don't need message search, or can accept the limitation

## Commands

### `channels list` — List channels

```bash
slack-api-cli channels list [--limit <number>] [--include-archived] [--json] [--plain]
```

| Flag | Required | Description |
|---|---|---|
| `--limit <number>` | No | Maximum number of channels to return |
| `--include-archived` | No | Include archived channels |
| `--json` | No | Output as JSON |
| `--plain` | No | Output as TSV |

### `channels create` — Create or reconcile a channel

```bash
slack-api-cli channels create 01-engineering \
  --workspace wedgeai \
  --topic "AI development" \
  --purpose "Discuss AI and software engineering decisions." \
  --dry-run
```

The command requires a workspace selected by `--workspace` or `SLAMY_DEFAULT_WORKSPACE` and verifies
the configured credential Team ID before writing.
An existing channel is reused instead of duplicated, then its topic and purpose are reconciled.
Use `--private` for a private channel. `--dry-run` does not resolve credentials or call Slack.
After a real write, `conversations.info` verifies the name, visibility, topic, and purpose.

### Global options

slamy provides separate Go and TypeScript CLI implementations. The available
root options depend on which CLI you installed.

Go CLI (`go install` or a source build):

| Flag | Description |
|---|---|
| `--workspace <alias>` | Use the configured Slack workspace alias for this invocation |
| `--json` | Output as JSON |
| `--plain` | Output as TSV |

TypeScript CLI:

| Flag | Description |
|---|---|
| `--workspace <selector>` | Use a registered workspace by alias, Team ID, or fully-qualified current/previous Slack domain |
| `--json` | Output as JSON |
| `--plain` | Output as TSV |
| `--utc` | Display timestamps in UTC (default: local TZ) |
| `--tz <iana>` | Display timestamps in the specified IANA timezone (e.g. `Asia/Tokyo`) |

The TypeScript CLI also provides offline workspace registry management:

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

Setting a registry default makes that workspace the selection when neither `--workspace` nor
`SLAMY_DEFAULT_WORKSPACE` is provided.

These commands do not call Slack and never accept token values. All TypeScript CLI commands that call
Slack resolve the root selector through this registry and verify every configured credential with
`auth.test` before creating an API client. The TypeScript library also includes an atomic
credential-set resolver, strict permalink Target resolver, and named workspace-aware Slack
operations.

### `channels history` — Get channel message history

```bash
slack-api-cli channels history <channel_or_url> [--limit <n>] [--oldest <ts>] [--latest <ts>] [--resolve-names]
```

| Flag | Required | Description |
|---|---|---|
| `<channel_or_url>` | Yes | Channel ID **or** Slack permalink URL |
| `--limit <n>` | No | Number of messages (default: 20) |
| `--oldest <ts>` | No | Only messages after this Unix timestamp |
| `--latest <ts>` | No | Only messages before this Unix timestamp |
| `--resolve-names` | No | Resolve `user_id` / `bot_id` to display names |

### `messages post` — Post a message

```bash
slack-api-cli messages post <channel_id> --text <message> [--as-user] [--thread-ts <ts>]
```

`--thread-ts <ts>` posts as a reply in that thread (format `1700000000.000100`; invalid values are rejected before calling Slack).

### `messages reply` — Reply to a thread

```bash
slack-api-cli messages reply <channel_or_url> [thread_ts] --text <message> [--broadcast]
```

`<channel_or_url>` accepts either a channel ID + thread_ts, or a single Slack permalink URL.

### `messages update` / `messages delete` — Edit messages

```bash
slack-api-cli messages update <channel_or_url> [ts] --text <new_text>
slack-api-cli messages delete <channel_or_url> [ts]
```

### `messages schedule` — Schedule a message for later

```bash
slack-api-cli messages schedule <channel_id> --text <message> --at <datetime>
```

`<datetime>` is a Unix timestamp or ISO 8601 (e.g. `2026-02-24T09:00+09:00`).

### `threads replies` — Get thread replies

```bash
slack-api-cli threads replies <channel_or_url> [thread_ts] [--limit <n>] [--resolve-names]
```

`<channel_or_url>` accepts a channel ID + thread_ts, or a single Slack permalink URL.

### `channels members` — List channel members

```bash
slack-api-cli channels members <channel_or_url> [--resolve-names]
```

`<channel_or_url>` accepts a channel ID or a Slack permalink URL. `--resolve-names` resolves `user_id` to display names.

### `users list` / `users profile` / `users set-real-name` / `users set-display-name`

```bash
slack-api-cli users list [--include-deactivated] [--include-bots]
slack-api-cli users profile <user_id>
slack-api-cli users set-real-name <user_id> <real_name>
slack-api-cli users set-display-name <user_id> <display_name>
```

`set-real-name` calls `users.profile.set`. It needs a user token (an admin's token on a paid plan to target another user or a bot) and is rejected with a bot token only or in a local session. The real name is limited to 50 characters.

`set-display-name` also calls `users.profile.set`: it needs a user token and is rejected with a bot token only or in a local session. The display name is limited to 80 characters.

### `assistant set-status` — Set AI Assistant thread status

```bash
slack-api-cli assistant set-status --channel <id> --thread <ts> --status <text> [--loading-message <text...>]
```

Sets the typing indicator status on an AI Assistant thread. Use `--plain` for machine-readable TSV output (`ok\t<channel>\t<thread>`), suitable for CI / shell scripting.

### `reactions get` — Get reactions on a specific message

```bash
slack-api-cli reactions get <channel_or_url> [timestamp] [--resolve-names]
```

Returns the emoji reactions and the users who added them. Useful before calling `reactions add` to check existing reactions.

### `reactions list` — List reactions made by a user

```bash
slack-api-cli reactions list [--user <user_id>] [--limit <n>] [--count] [--resolve-names]
```

`--resolve-names` resolves `channel_id` to channel names (`#general` instead of `#C0123ABCDE`).

Note: `reactions list` (lists reactions *by* a user) and `reactions get` (gets reactions *on* a message) are different APIs.

### `reactions add` / `reactions remove` — Add/remove emoji reaction

```bash
slack-api-cli reactions add <channel_or_url> [timestamp] --name <emoji>
slack-api-cli reactions remove <channel_or_url> [timestamp] --name <emoji>
```

### `search messages` — Search messages

```bash
slack-api-cli search messages <query> [--count <n>] [--page <n>] [--sort <field>] [--sort-dir <dir>] [--resolve-names]
```

| Flag | Required | Description |
|---|---|---|
| `<query>` | Yes | Search query (supports Slack modifiers like `in:#channel`, `from:@user`) |
| `--count <n>` | No | Results per page (default: 20) |
| `--page <n>` | No | Page number (default: 1) |
| `--sort <field>` | No | Sort by `timestamp` or `score` (default: timestamp) |
| `--sort-dir <dir>` | No | `asc` or `desc` (default: desc) |
| `--resolve-names` | No | Resolve `user_id` to display names |

#### Channel filters in `in:`

Slack accepts a channel **name** (`in:general`, `in:#general`) or a channel **mention** (`in:<#C0123456789>`) for the `in:` modifier. A bare channel ID is **not** a valid filter:

```bash
slack-api-cli search messages 'in:general'            # OK
slack-api-cli search messages 'in:#general'           # OK
slack-api-cli search messages 'in:<#C0123456789>'     # OK — a channel ID works in mention form
slack-api-cli search messages 'in:C0123456789'        # returns 0 matches, without an error
```

Prefer the mention form when you only have a channel ID: it filters correctly and needs no name lookup. The bare-ID form fails silently, which is easy to misread as "this channel has no matching messages".

### `auth test` — Test authentication

```bash
slack-api-cli auth test [--json] [--plain]
```

### `team info` — Get workspace info

```bash
slack-api-cli team info [--json] [--plain]
```

Returns the workspace domain, `email_domain`, and Enterprise info. The `email_domain` is useful for diagnosing SSO domain mismatches. Requires the `team:read` scope. Note: SSO enforcement settings are **not** exposed by the Slack API.

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SLAMY_CONFIG_FILE` | No | Override the TypeScript workspace registry path; defaults to `$XDG_CONFIG_HOME/slamy/workspaces.json` or `~/.config/slamy/workspaces.json` |
| `SLAMY_WORKSPACE_<ALIAS>_USER_TOKEN` | When its alias is selected | User OAuth Token for a workspace alias; uppercase the alias and replace hyphens with underscores |
| `SLAMY_DEFAULT_WORKSPACE` | No | Registered workspace selector (alias, Team ID, or fully-qualified current/previous Slack domain) to use when `--workspace` is omitted |
| `SLACK_USER_TOKEN` | Yes for legacy single-workspace use | Legacy Slack User OAuth Token (`xoxp-...`) — used only when neither an explicit nor default workspace selector is set |
| `SLACK_BOT_TOKEN` | Yes (either) | Slack Bot OAuth Token (`xoxb-...`) — used for write operations and `reactions get` |
| `SLAMY_TZ` | No | IANA timezone used by `engagement` commands (default: `Asia/Tokyo`) |
| `SLACK_TEAM_ID` | No | Slack Team ID (for workspace-specific operations) |

When both `SLACK_USER_TOKEN` and `SLACK_BOT_TOKEN` are set in legacy mode, slamy uses each token for the operations it best fits.

### Multiple Workspaces

The TypeScript workspace registry uses Slack Team ID as the canonical identifier. Alias, current
domain, previous domains, display name, default state, and credential references are mutable
attributes. A reference contains a validated provider ID and an opaque reference name. The built-in
provider resolves environment-variable names; custom providers can resolve Keychain or OAuth
references without changing workspace records. The registry stores reference names only, never
token values. It rejects corrupt JSON, unknown fields, duplicate Team IDs, aliases or domains,
dangling defaults, symlinks, and group/other-readable files. Updates replace the complete document
atomically.

Use `workspace list/add/remove/show/default` as shown above. `--json` and `--plain` are supported.
The dedicated config directory is created with mode `0700` and the registry file with mode `0600`
on POSIX systems.

Library integrations can use `createCredentialResolver()` to resolve every configured User/Bot
reference for one `WorkspaceRecord` as a single verified set. The resolver never substitutes one
token kind for another, verifies all configured credentials before returning any of them, rejects
cross-workspace User/Bot combinations, and never falls back from a registry workspace to legacy
global token variables. Raw token values are redacted from string, JSON, inspection, provider-error,
and verification-error paths. Call `destroy()` on the returned set when the operation finishes; it
idempotently destroys every credential in the set. Custom providers and verifiers are trusted
components because their interfaces necessarily receive raw token material. Validate and isolate
their implementations accordingly.

Slack `auth.test` proves identity and Team ID but does not attest operation scopes. A requirement may
carry scope metadata such as User `search:read`. The workspace-aware adapter checks this declared
contract before transport and normalizes Slack's eventual `missing_scope` response as a secret-safe
platform error; the declaration is not proof of the token's grants.

Library callers create one explicit context from a verified credential set and pass it to every
named operation:

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

The package exposes named slamy-owned DTOs only, not a generic `apiCall`. Policies pin each operation
to one User or Bot credential kind and its required scope metadata. Calls use a non-cached SDK client
with automatic retries disabled; rate limits surface as `SlackAdapterError` with
`retryAfterSeconds`. Cursor traversal follows `response_metadata.next_cursor`, rejects repeated or
malformed cursors, and is bounded. Diagnostics contain only a local request ID, method, Team ID,
credential kind, outcome, and normalized error code. The local request ID is a slamy correlation ID,
not Slack's `x-slack-req-id`. For methods that support organization-wide tokens, the method policy
maps the explicit context Team ID to Slack's documented `team` or `team_id` argument.

Library integrations can also use `createTargetResolver()` with an injected `WorkspaceCatalog`.
The resolver accepts Slack `archives` permalinks (including `thread_ts` and `cid`),
`app.slack.com/client` channel or observed thread URLs, and strict legacy channel IDs with optional
message/thread timestamps. It returns one immutable Target containing the selected workspace,
channel, message, and thread evidence. Selection is fail-closed in this order: explicit workspace,
Target Team ID, registered current or previous hostname, then the registry default only for inputs
without a URL. Conflicting or unregistered URL evidence never falls back to the default.

Slack Connect channel ownership is deliberately reported as `unknown`. A single execution workspace
may be selected from unambiguous evidence, but slamy does not infer which connected workspace owns
the channel. Multiple candidate Team IDs and Enterprise-only `app.slack.com` URLs require explicit
workspace disambiguation. Parsing and workspace selection do not access credentials or call Slack.

The environment-variable alias behavior below is the legacy Go CLI contract. It remains read-only
compatible throughout v2 and may be removed no earlier than v3.0.0. The variables cannot be safely
auto-imported because they do not prove a Slack Team ID. See the
[workspace registry migration guide](docs/migrations/workspace-registry-v2.md).

A workspace alias is a local identifier. It is independent of the workspace name, domain, and Team ID in Slack, and slamy does not discover or match aliases automatically. An alias must be 1–63 characters and match `^[a-z0-9]+(?:-[a-z0-9]+)*$` (for example, `primary`, `operations`, or `project-a`).

Configure one User OAuth Token for each alias. The environment variable name is formed by uppercasing the alias and replacing hyphens with underscores:

```bash
export SLAMY_DEFAULT_WORKSPACE=primary
export SLAMY_WORKSPACE_PRIMARY_USER_TOKEN='<user-token>'
export SLAMY_WORKSPACE_OPERATIONS_USER_TOKEN='<user-token>'
export SLAMY_WORKSPACE_PROJECT_A_USER_TOKEN='<user-token>'
```

For every TypeScript CLI command that calls Slack, the workspace selection order is:

1. The root flag `--workspace <selector>`, accepting a registry alias, Team ID, or fully-qualified current/previous Slack domain
2. `SLAMY_DEFAULT_WORKSPACE`
3. The registry default set by `slack-api-cli workspace default <selector>`
4. Legacy `SLACK_USER_TOKEN` / `SLACK_BOT_TOKEN`, only when neither selector source nor a registry default is set

There is no `SLAMY_WORKSPACE` selector environment variable; use `--workspace` for an explicit selection.

```bash
# Uses the default alias, primary
slack-api-cli channels list

# Explicit selection takes precedence over the default
slack-api-cli --workspace operations channels list
slack-api-cli --workspace project-a auth test
```

Registry selection is fail-closed. slamy resolves only the selected workspace's configured
credential references, verifies their `auth.test` Team ID against the registry, and creates no API
client on missing credentials, identity mismatch, ambiguous/unknown selection, or cross-workspace
User/Bot credentials. It never falls back to `SLACK_USER_TOKEN`, `SLACK_BOT_TOKEN`, or another
workspace after a registry selector is present.

Commands accepting `channel_or_url` resolve supported Slack permalinks before creating an API client.
The permalink hostname or Team ID must identify the selected workspace, including registered
previous domains; conflicting, unknown, or non-Slack URL evidence fails without an API call. With no
explicit/default selector, a permalink uses its registered workspace rather than legacy global
credentials. A plain channel ID with no selector retains legacy single-workspace behavior.

Existing single-workspace setups remain compatible: keep `SLACK_USER_TOKEN` and/or
`SLACK_BOT_TOKEN`, and leave both `--workspace` and `SLAMY_DEFAULT_WORKSPACE` unset. To migrate, add
the token environment variable as a credential reference on a registry workspace, set
`SLAMY_DEFAULT_WORKSPACE` to one of its accepted selectors, then remove the legacy variables after
verifying the new setup.

Treat every token as a secret. Do not commit tokens to a repository, pass them as command-line arguments, or print them to logs, standard output, standard error, or JSON. Provide them through protected environment or secret-management facilities.

## Output Formats

### Text (default)

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

The TypeScript package exports `SlamyClient` for Slack Web API operations and `SlamyEvents` for Socket Mode events. Node.js 25 or later is required.

```ts
import { SlamyClient } from "slamy";

const client = new SlamyClient({ userToken: process.env.SLACK_USER_TOKEN });
const channels = await client.listChannels();
```

Pass tokens through protected environment or secret-management facilities. See the exported TypeScript types for the complete API surface.

## Development

```bash
# Build and test the Go CLI
cd go-src
go build -o ../slamy .
go test -race ./...
go test -cover ./...

# Build and test the TypeScript API and CLI
cd ..
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and coding standards.
See [docs/TESTING.md](docs/TESTING.md) for the comprehensive testing guide.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting a Pull Request.

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT

## Links

- [GitHub Repository](https://github.com/tackeyy/slack-api-cli)
- [Slack API Documentation](https://api.slack.com/docs)

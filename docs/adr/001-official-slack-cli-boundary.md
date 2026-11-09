# ADR 001: Boundary between the official Slack CLI and slamy

- Status: Accepted
- Date: 2026-07-21
- Issue: [#85](https://github.com/tackeyy/slamy/issues/85)
- Parent initiative: [#82](https://github.com/tackeyy/slamy/issues/82)

## Context

Slack provides an official `slack` CLI for creating and managing Slack apps. It covers app
authorization, app manifests, local app execution, deployment, logs, documentation lookup, and
direct Web API calls through `slack api`.

slamy also calls the Slack Web API, but its intended users and abstraction level are different.
slamy is a high-level command and TypeScript client for humans and agents that need to read,
search, and operate Slack predictably across workspaces. Without an explicit boundary, slamy
could duplicate the official CLI as a generic Web API passthrough or depend on private details of
the official CLI's credentials.

The repository currently contains separate Go and TypeScript CLIs. Replacing the Go CLI and
implementing the complete multi-workspace design are follow-up work under #82. This decision does
not claim that those changes have already shipped.

## Decision

The official Slack CLI and slamy have separate responsibilities.

The following matrix defines the target responsibility boundary after the #82 rollout. It is a
scope decision, not a claim that every slamy capability in the table is currently available.

| Responsibility | Official `slack` CLI | slamy |
|---|---|---|
| Create, link, install, uninstall, and configure Slack apps | Owner | Out of scope |
| App manifests, local run, deploy, activity, logs, and app documentation | Owner | Out of scope |
| Ad hoc invocation of an arbitrary Web API method | Owner through `slack api` | Out of scope; no generic `slamy api` command |
| Select a team explicitly for an official CLI command | Owner through `--team` where supported | Out of scope |
| Resolve slamy's default, explicit, or permalink-derived target consistently across high-level workflows | Out of scope | Owner |
| Parse Slack permalinks and route an operation to the correct workspace | Out of scope | Owner |
| Perform automatic cursor pagination and return complete high-level results | Out of scope | Owner |
| Resolve Slack IDs to useful display names and normalize machine-readable output | Out of scope | Owner |
| Provide task-oriented read, search, post, reply, reaction, and file workflows | Primitive API calls are available | Owner |
| Provide a reusable TypeScript library for those task-oriented workflows | Out of scope | Owner |

The current repository still has separate Go and TypeScript CLIs, and capability availability
varies by command. The command documentation in the READMEs describes shipped behavior; the #82
child issues track delivery of the unified target-state behavior above.

slamy will call Slack's public Web API through supported TypeScript packages such as
`@slack/web-api`. It will not invoke the official CLI as a subprocess and will not read or modify
the official CLI-owned credential store. That store contains sensitive tokens, is controlled by
the official CLI, and is not a documented integration contract for slamy. Depending on it would
increase token exposure and couple slamy to another tool's implementation and credential
lifecycle.

The official CLI's authorized developer accounts and slamy's workspace registry are separate
concepts. In particular, `slack auth list` lists accounts authorized for official CLI app
development, while `slack api` can resolve a token from command flags, a selected app, environment
variables, or an interactive selection. Neither interface is a documented workspace credential
store that slamy should adopt as its own.

The repository and executable retain the name `slamy`.

Note: On 2026-11-08, the `slack-api-cli` command was added and `slamy` was retained as an alias ([#170](https://github.com/tackeyy/slack-api-cli/pull/170)).

## Feature acceptance test

A proposed slamy feature must pass all of the following checks:

1. The official CLI does not already provide the complete task-oriented workflow, and the proposal
   is not merely a generic wrapper around an official CLI command or arbitrary Web API method.
2. It adds a task-oriented workflow or reusable behavior for humans or agents, such as workspace
   selection, permalink routing, pagination, name resolution, stable output, or safe message
   handling.
3. It can be implemented against documented public Slack APIs without invoking the official CLI
   or reading its private state.
4. Its behavior and failure modes can be represented by a stable CLI or TypeScript contract and
   covered by automated tests.

If a proposal fails check 1 or 3, contributors should use or improve the official Slack CLI rather
than add the feature to slamy.

## Consequences

### Positive

- slamy remains focused on high-level, agent-friendly Slack operations.
- Users can use the official CLI and slamy together without either tool owning the other's private
  authentication state.
- Future commands have a consistent acceptance test and avoid a second generic Slack API CLI.
- The TypeScript replacement can expose one shared behavior across the CLI and library layers.

### Trade-offs

- Users may configure authentication separately for official app development and slamy workspace
  operations.
- slamy must maintain its own documented workspace registry and token resolution behavior.
- Some task-oriented commands will internally compose several Web API methods that the official
  CLI can invoke individually.

## Non-goals

- Replacing the official Slack CLI's app development lifecycle.
- Providing a one-to-one command for every Slack Web API method.
- Importing or synchronizing private official CLI credential storage.
- Completing the TypeScript replacement or multi-workspace implementation in this ADR.

## Re-evaluation and exit criteria

Repository maintainers must review this boundary for every new slamy feature proposal and whenever
an official Slack CLI release changes user operations or public authentication contracts. Record
the result in the proposal issue or pull request and update this ADR when the boundary changes. A
slamy feature should be deprecated when the official CLI provides all of the following through
documented, stable interfaces:

- equivalent task-oriented behavior, including workspace and permalink routing where applicable;
- complete pagination and comparable name resolution and machine-readable output;
- a supported automation contract with compatible error handling; and
- a migration path that does not require consumers to depend on private credential storage.

Deprecation requires a separate issue, compatibility assessment, documented migration path, and a
release window. The existence of a low-level `slack api` method alone is not sufficient reason to
remove a high-level slamy workflow.

## Follow-up rollout

The parent initiative [#82](https://github.com/tackeyy/slamy/issues/82) tracks the implementation.
In particular:

- [#87](https://github.com/tackeyy/slamy/issues/87) defines the TypeScript module architecture.
- [#84](https://github.com/tackeyy/slamy/issues/84),
  [#86](https://github.com/tackeyy/slamy/issues/86), and
  [#83](https://github.com/tackeyy/slamy/issues/83) implement workspace configuration,
  credentials, and target resolution.
- [#92](https://github.com/tackeyy/slamy/issues/92) establishes the shared Slack adapter.
- [#93](https://github.com/tackeyy/slamy/issues/93) removes the Go implementation after parity is
  verified.

## References

- [Slack CLI overview](https://docs.slack.dev/tools/slack-cli/)
- [`slack api` reference](https://docs.slack.dev/tools/slack-cli/reference/commands/slack_api/)
- [`slack auth list` reference](https://docs.slack.dev/tools/slack-cli/reference/commands/slack_auth_list/)

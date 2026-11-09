# Local authentication session security record

## Executive summary

slamy can keep a verified Slack credential in one detached local process for up to seven days.
The credential enters the process through standard input, is never written to the workspace
registry or session metadata, and is never returned to subsequent CLI processes. CLI operations
are brokered over an owner-only Unix socket and restricted to Slack methods already used by
slamy. The default lifetime is 24 hours; seven days requires an explicit `--ttl 7d`.

This design is appropriate for a personal, FileVault-enabled Mac whose current macOS user account
is trusted. It does not protect against malware, administrator access, or another process already
running as the same macOS user. Such a process can use the local broker while the session is
active, although it cannot retrieve the reusable Slack token through the broker protocol.

## Data flow

1. A password manager writes one Slack token to `slack-api-cli auth session start` through standard input.
2. slamy verifies token kind and canonical Slack Team ID with `auth.test`.
3. The launcher passes the credential once to a detached child through an anonymous standard-input
   pipe. The token is absent from child arguments and its allowlisted environment.
4. The child verifies the Team ID again, listens on an owner-only Unix socket, and writes only a
   local capability plus non-secret timestamps and workspace identity to metadata.
5. Later slamy processes read the metadata and send allowlisted Slack operations to the broker.
   The broker performs the operation and returns only the Slack API result.
6. Expiry or `revoke` stops new requests, removes the socket and metadata, and ends the daemon.

When `--foreground` is selected, steps 3 and 4 run in the current supervisor-owned process instead
of a detached child. Token input, identity verification, storage, IPC, expiry, and revoke controls
remain unchanged.

## Security controls

| Boundary | Control |
|---|---|
| Lifetime | 24-hour default, seven-day hard maximum, absolute expiry checked per request |
| Workspace | Canonical Team ID and User/Bot credential kind fixed at start and checked again by daemon |
| Credential scope | Enterprise org tokens and mixed User+Bot workspace definitions are rejected |
| Secret input | Standard input only; no token command-line option |
| Child process | Token excluded from argv and persistent environment; minimal environment allowlist |
| Storage | Session directories `0700`; metadata and Unix socket `0600`; no Slack token on disk |
| IPC | Random local capability, four-connection limit, 30-second timeout, 32 MiB message ceiling, typed codec, method allowlist, generic errors |
| Path safety | Owner checks and symlink rejection for session directories and metadata |
| Revocation | Broker stops accepting requests and removes metadata/socket before acknowledging revoke |
| Logging | Credential wrappers redact string, JSON, and inspection output; broker errors are sanitized |

## Residual risks

- A process running as the same macOS user can invoke the broker during the active lifetime.
- JavaScript and the Slack SDK can create temporary in-memory string copies that cannot be
  deterministically zeroed.
- Crash dumps, swap, endpoint-management software, administrator access, and a compromised kernel
  are outside this boundary.
- Local `revoke` does not rotate or invalidate the Slack OAuth token. Suspected disclosure still
  requires provider-side token rotation.
- File downloads in session mode are streamed into bounded IPC buffers and limited to approximately
  16 MiB.

## Operator commands

```bash
op read 'op://<vault>/<item>/<field>' |
  slack-api-cli --workspace wedgeai auth session start --ttl 7d

slack-api-cli --workspace wedgeai auth session status
slack-api-cli --workspace wedgeai auth session revoke
```

Use 24 hours unless a longer unattended window is necessary. Revoke the local session when the
window ends; rotate the Slack token separately if disclosure is suspected.

## Verification

- Canary tests assert that tokens do not appear in argv, daemon environment, response payloads,
  metadata, or command output.
- Tests cover TTL boundaries, Team ID and token-kind mismatch, workspace argument binding, method
  allowlisting, malformed metadata, file-buffer encoding, owner-only permissions, symlink rejection,
  exact expiry, broker revocation, and existing client/CLI wiring.
- Required repository checks are `npm test`, `npm run typecheck`, `npm run build`,
  `npm run check:architecture`, and Markdown lint.

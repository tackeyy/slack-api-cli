# Workspace Registry v2 Migration

## Scope and timing

The TypeScript workspace registry introduced by Issue #84 is the management layer for workspace
identity. Slack Team ID is its canonical key. Aliases, domains, names, defaults, and credential
references are attributes.

Issue #86 adds the TypeScript library credential resolver and `auth.test` Team ID verification.
Issue #83 adds strict URL-based workspace routing, and Issue #92 adds explicit-context named Slack
operations to the library. Existing CLI commands and `SlamyClient` remain on their compatibility path
until the vertical command migrations in Issues #89 and #91. Do not remove working legacy token
variables until every command you use has migrated and been verified.

Legacy `SLAMY_DEFAULT_WORKSPACE` and `SLAMY_WORKSPACE_<ALIAS>_USER_TOKEN` inputs remain read-only
compatible for the v2 release line. They are deprecated for new configuration and may be removed
no earlier than v3.0.0. Alias-specific Bot token input is not part of the legacy Go contract.

## Why migration is not automatic

Legacy variables contain an alias and token value but do not prove the Slack Team ID, current
domain, or domain history. Creating a Team-ID-keyed record from them without `auth.test`
verification could associate a credential with the wrong workspace. slamy therefore never imports
these variables automatically and never writes their token values to the registry.

## Registry location and security

The default path is `$XDG_CONFIG_HOME/slamy/workspaces.json`, or
`~/.config/slamy/workspaces.json` when `XDG_CONFIG_HOME` is unset. `SLAMY_CONFIG_FILE` may override
the path for isolated automation and testing.

On POSIX systems slamy creates the dedicated directory with mode `0700` and the registry file with
mode `0600`. A symlink, non-regular file, different owner, or group/other permission causes a
fail-closed error. Each mutation writes and syncs a private temporary file in the same directory,
then replaces the registry with an atomic rename. A private `.lock` file serializes the complete
read-validate-write transaction across processes. Lock acquisition times out after five seconds;
slamy never removes a stale lock automatically. Remove one manually only after confirming that no
slamy process is updating the registry.

If slamy reports that directory durability could not be confirmed, the atomic rename has already
occurred and the new registry may be active. Inspect `workspace list` before deciding whether to
retry the operation.

The registry stores only credential reference names such as
`SLAMY_WORKSPACE_PRIMARY_USER_TOKEN` or `primary/user`. It never stores the referenced value.
Provider IDs are an additive version 1 extension point: structurally valid but unavailable providers
remain stored and fail closed at resolution time. A change to the registry document shape requires a
new registry version.

## Migration steps

1. Determine the real Slack Team ID and current workspace domain using an already trusted Slack
   session. Do not infer Team ID from an alias or domain.
2. Add the workspace record while referencing the existing environment-variable name:

   ```bash
   slack-api-cli workspace add \
     --team-id T01234567 \
     --alias primary \
     --domain primary.slack.com \
     --name "Primary" \
     --user-token-env SLAMY_WORKSPACE_PRIMARY_USER_TOKEN \
     --default
   ```

3. Inspect the record with `slack-api-cli workspace show primary` and `slack-api-cli workspace list --json`.
4. Keep the referenced environment variable protected and available. The registry contains its
   name, not its value.
5. Use the Issue #86 library resolver to verify every configured token against the record's Team ID.
   Treat User and Bot credentials as one set; any missing required kind, token-kind mismatch,
   cross-Team combination, or `auth.test` mismatch is a fail-closed error.
6. Verify permalink-derived routing through the Issue #83 library API. Library integrations may
   combine the selected workspace, Issue #86 credential set, and Issue #92 Slack adapter explicitly.
   Existing CLI commands continue on their legacy path until Issues #89 and #91 migrate them.
7. Remove legacy selectors only after every command you use has migrated and its fail-closed behavior
   has been verified. v2 itself does not require their removal.

When a registry default exists, it is the managed default. A legacy `SLAMY_DEFAULT_WORKSPACE`
value must not silently override it. Explicit registry selection must never fall back to an
unrelated legacy token.

The resolver's registry API and legacy single-workspace API are separate. Registry-backed
resolution reads only the credential reference names stored on that workspace and cannot fall back
to `SLACK_USER_TOKEN`, `SLACK_BOT_TOKEN`, or another alias. The legacy API reads only the two global
token variables, derives Team ID with `auth.test`, and rejects a cross-Team User/Bot pair. It remains
read-only compatibility for v2 and may be removed no earlier than v3.0.0.

`auth.test` does not return a credential's granted scope set. It verifies identity and Team ID only.
The Issue #92 Slack adapter checks operation-specific declared scope metadata before transport and
normalizes `missing_scope` as a safe platform error. This metadata is a caller contract, not an
attestation of scopes actually granted by Slack.

## Rollback

Registry management is additive in Issue #84. If migration needs to pause, keep the registry file
for later and continue using the unchanged legacy command path. Do not copy token values into the
registry as a workaround.

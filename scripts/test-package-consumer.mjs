import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const fixture = mkdtempSync(join(tmpdir(), "slamy-package-consumer-"));

try {
  const helpResult = spawnSync(process.execPath, ["dist/cli/index.js", "--help"], {
    cwd: root,
    encoding: "utf8",
  });
  if (helpResult.status !== 0 || !helpResult.stdout.includes("Usage: slack-api-cli")) {
    process.stderr.write(helpResult.stdout ?? "");
    process.stderr.write(helpResult.stderr ?? "");
    process.stderr.write("CLI help must succeed and show Usage: slack-api-cli\n");
    process.exitCode = helpResult.status || 1;
  }

  const nodeModules = join(fixture, "node_modules");
  mkdirSync(nodeModules);
  symlinkSync(root, join(nodeModules, "slamy"), "dir");
  writeFileSync(join(fixture, "package.json"), '{"type":"module"}\n', "utf8");
  writeFileSync(
    join(fixture, "consumer.mts"),
    `import {
  createCredentialResolver,
  createSlackWorkspaceContext,
  createTargetResolver,
  createWorkspaceSlackAdapter,
  createWorkspaceRecord,
  parseTeamId,
  type AuthVerifier,
  type CredentialHandle,
  type CredentialProvider,
  type CredentialReference,
  type CredentialRequirement,
  type WorkspaceCatalog,
  type WorkspaceView,
  type VerifiedCredentialSet,
} from "slamy";

const provider: CredentialProvider = {
  providerId: "keychain",
  resolveMany(references: readonly CredentialReference[]) {
    return Promise.resolve(new Map(references.map(({ name }) => [name, "xoxp-fixture"])));
  },
};
const verifier: AuthVerifier = {
  verify(secret: CredentialHandle) {
    return secret.use(() => Promise.resolve({ teamId: parseTeamId("T00000001") }));
  },
};
const workspace = createWorkspaceRecord({
  teamId: "T00000001",
  alias: "primary",
  domain: "primary.slack.com",
  displayName: "Primary",
  credentialRefs: { user: { provider: "keychain", name: "primary/user" } },
});
const requirement: CredentialRequirement = { requiredKinds: ["user"] };
const resolver = createCredentialResolver({ providers: [provider], verifier });
const workspaceView: WorkspaceView = { ...workspace, isDefault: true };
const catalog: WorkspaceCatalog = { list: () => Promise.resolve([workspaceView]) };
const targetResolver = createTargetResolver({ workspaceCatalog: catalog });
const slackAdapter = createWorkspaceSlackAdapter({ requestIdFactory: () => "consumer-request" });
const slackContext = createSlackWorkspaceContext({
  teamId: workspace.teamId,
  credentials: {
    teamId: workspace.teamId,
    user: {
      kind: "user",
      teamId: workspace.teamId,
      use: <Result,>(consumer: (token: string) => Result) => consumer("xoxp-fixture"),
      destroy() {},
    },
    requiredScopes: { user: ["team:read"] },
    destroy() {},
  },
});

async function consume(): Promise<VerifiedCredentialSet> {
  const set = await resolver.resolveForWorkspace(workspace, requirement);
  set.destroy();
  return set;
}

void consume;
void targetResolver.resolve({ input: "C0123ABC" });
void slackAdapter.getTeamInfo(slackContext);
// @ts-expect-error slamy intentionally has no generic Slack API passthrough.
void slackAdapter.apiCall("users.list", {});
`,
    "utf8",
  );

  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "consumer.mts",
    ],
    { cwd: fixture, encoding: "utf8" },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.status ?? 1;
  } else {
    const declaration = readFileSync(join(root, "dist", "lib", "index.d.ts"), "utf8");
    if (/@slack\/web-api|WebAPICallResult|apiCall\s*\(/.test(declaration)) {
      process.stderr.write("Package-root declarations expose a Slack SDK or generic API surface\n");
      process.exitCode = 1;
    }
    if (process.exitCode === undefined) {
      process.stdout.write("Package-root consumer compile: OK\n");
    }
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

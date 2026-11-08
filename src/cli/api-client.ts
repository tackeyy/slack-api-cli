import { validateWorkspaceProfile } from "../lib/local-session-files.js";
import {
  CredentialResolver,
  SlamyClient,
  createCredentialResolver,
  createWorkspaceRegistry,
  WorkspaceRegistryError,
  type CredentialKind,
  type SlamyClientOptions,
  type TeamId,
  type VerifiedCredentialSet,
  type WorkspaceRecord,
  type WorkspaceRegistry,
} from "../lib/index.js";
import type { LocalSessionConnection } from "../lib/local-session-web-client.js";
import { findLocalSessionForWorkspace } from "../lib/local-session-files.js";
import { buildAuthGuidanceMessage } from "../lib/cli-errors.js";

export type CliApiClientLease<Client = SlamyClient> = {
  readonly client: Client;
  readonly teamId?: TeamId;
  dispose(): void;
};

export type CreateCliApiClientOptions<Client = SlamyClient> = {
  explicitWorkspace?: string;
  profile?: string;
  env?: NodeJS.ProcessEnv;
  registry?: WorkspaceRegistry;
  credentialResolver?: CredentialResolver;
  clientFactory?: (tokens: SlamyClientOptions) => Client;
  localSessionLookup?: (
    workspace: WorkspaceRecord & { profile?: string },
  ) => Promise<LocalSessionConnection | undefined>;
};

export function resolveCliWorkspaceSelector(
  explicitWorkspace: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return explicitWorkspace ?? env.SLAMY_DEFAULT_WORKSPACE;
}

export function collectCliWorkspaceSelector(
  selector: string,
  previous: string | undefined,
): string {
  if (previous !== undefined && previous !== selector) {
    throw new Error("Conflicting --workspace selectors");
  }
  return selector;
}

export function collectCliProfileSelector(profile: string, previous: string | undefined): string {
  validateWorkspaceProfile(profile);
  if (previous !== undefined && previous !== profile) throw new Error("Conflicting --profile selectors");
  return profile;
}

export async function createCliApiClient<Client = SlamyClient>(
  options: CreateCliApiClientOptions<Client> = {},
): Promise<CliApiClientLease<Client>> {
  if (options.profile !== undefined) validateWorkspaceProfile(options.profile);
  const env = options.env ?? process.env;
  const selector = resolveCliWorkspaceSelector(options.explicitWorkspace, env);
  const clientFactory =
    options.clientFactory ??
    ((tokens: SlamyClientOptions) => new SlamyClient(tokens) as Client);
  const registry = options.registry ?? createWorkspaceRegistry({ env });
  const resolvedWorkspace =
    selector === undefined
      ? await resolveDefaultWorkspace(registry)
      : await registry.resolve(selector);

  if (options.profile !== undefined && resolvedWorkspace === undefined) {
    throw new Error("A registered workspace is required for --profile");
  }
  const workspace = options.profile === undefined ? resolvedWorkspace :
    await registry.resolve(resolvedWorkspace!.teamId, options.profile);

  if (workspace === undefined) {
    const userToken = env.SLACK_USER_TOKEN;
    const botToken = env.SLACK_BOT_TOKEN;
    if (!userToken && !botToken) {
      // legacy token が無い場合は self-documenting な案内を出す
      const workspaces = await registry.list().catch(() => []);
      const workspaceAliases = workspaces.map((w) => w.alias);
      const guidance = buildAuthGuidanceMessage({
        workspaceAliases,
        hasLegacyUserToken: false,
        hasLegacyBotToken: false,
      });
      throw new Error(guidance);
    }
    return {
      client: clientFactory(legacyTokens(env)),
      dispose() {},
    };
  }

  const localSessionLookup =
    options.localSessionLookup ??
    (env === process.env
      ? (selected: WorkspaceRecord) => findLocalSessionForWorkspace(selected, env)
      : noLocalSession);
  const localSession = await localSessionLookup(workspace);
  if (localSession !== undefined) {
    const requirement = requirementFor(workspace);
    if (
      localSession.teamId !== workspace.teamId ||
      !requirement.requiredKinds.includes(localSession.credentialKind)
    ) {
      throw new Error("Local session does not match the selected workspace");
    }
    return {
      client: clientFactory({ localSession }),
      teamId: workspace.teamId,
      dispose() {},
    };
  }
  const resolver = options.credentialResolver ?? createCredentialResolver({ env });
  const credentials = await resolver.resolveForWorkspace(
    workspace,
    requirementFor(workspace),
  );

  try {
    return {
      client: clientFactory(clientOptions(credentials)),
      teamId: credentials.teamId,
      dispose: once(() => credentials.destroy()),
    };
  } catch (error) {
    credentials.destroy();
    throw error;
  }
}

async function resolveDefaultWorkspace(
  registry: WorkspaceRegistry,
): Promise<WorkspaceRecord | undefined> {
  try {
    return await registry.resolve();
  } catch (error) {
    if (
      error instanceof WorkspaceRegistryError &&
      (error.code === "DEFAULT_NOT_FOUND" || error.code === "WORKSPACE_NOT_FOUND")
    ) {
      return undefined;
    }
    throw error;
  }
}

function noLocalSession(): Promise<undefined> {
  return Promise.resolve(undefined);
}

function requirementFor(workspace: WorkspaceRecord): {
  requiredKinds: readonly CredentialKind[];
  operation: string;
} {
  const requiredKind: CredentialKind = workspace.credentialRefs?.user
    ? "user"
    : workspace.credentialRefs?.bot
      ? "bot"
      : "user";
  return {
    requiredKinds: [requiredKind],
    operation: "cli",
  };
}

function clientOptions(credentials: VerifiedCredentialSet): SlamyClientOptions {
  return {
    ...(credentials.user
      ? { userToken: credentials.user.use((token) => token) }
      : {}),
    ...(credentials.bot
      ? { botToken: credentials.bot.use((token) => token) }
      : {}),
  };
}

function legacyTokens(env: NodeJS.ProcessEnv): SlamyClientOptions {
  const userToken = env.SLACK_USER_TOKEN;
  const botToken = env.SLACK_BOT_TOKEN;
  if (!userToken && !botToken) {
    throw new Error("SLACK_USER_TOKEN or SLACK_BOT_TOKEN is not set");
  }
  return {
    ...(userToken ? { userToken } : {}),
    ...(botToken ? { botToken } : {}),
  };
}

function once(dispose: () => void): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    dispose();
  };
}

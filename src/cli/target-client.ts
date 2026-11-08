import { validateWorkspaceProfile } from "../lib/local-session-files.js";
import {
  createTargetResolver,
  createWorkspaceRegistry,
  parseSlackTarget,
  type WorkspaceRegistry,
} from "../lib/index.js";
import {
  createCliApiClient,
  resolveCliWorkspaceSelector,
  type CliApiClientLease,
} from "./api-client.js";

export type CliResolvedTarget = {
  readonly channel: string;
  readonly ts?: string;
  readonly thread_ts?: string;
};

export type CliTargetClient<Client> = CliApiClientLease<Client> & {
  readonly target: CliResolvedTarget;
};

export type CliClientLeaseFactory<Client> = (
  workspaceSelector: string | undefined,
  registry: WorkspaceRegistry | undefined,
  profile?: string,
) => Promise<CliApiClientLease<Client>>;

export type CreateCliTargetClientOptions<Client> = {
  input: string;
  messageTs?: string;
  threadTs?: string;
  explicitWorkspace?: string;
  profile?: string;
  env?: NodeJS.ProcessEnv;
  registry?: WorkspaceRegistry;
  clientLeaseFactory?: CliClientLeaseFactory<Client>;
};

export async function createCliTargetClient<Client>(
  options: CreateCliTargetClientOptions<Client>,
): Promise<CliTargetClient<Client>> {
  if (options.profile !== undefined) validateWorkspaceProfile(options.profile);
  const env = options.env ?? process.env;
  const selectedWorkspace = resolveCliWorkspaceSelector(
    options.explicitWorkspace,
    env,
  );
  const clientLeaseFactory =
    options.clientLeaseFactory ??
    ((workspaceSelector: string | undefined, registry: WorkspaceRegistry | undefined) =>
      createCliApiClient({
        explicitWorkspace: workspaceSelector,
        profile: options.profile,
        env,
        ...(registry ? { registry } : {}),
      }) as Promise<CliApiClientLease<Client>>);

  if (options.profile === undefined && selectedWorkspace === undefined && !isUrlInput(options.input)) {
    const lease = await clientLeaseFactory(undefined, undefined);
    return {
      ...lease,
      target: legacyTarget(options.input, options.messageTs, options.threadTs),
    };
  }

  const registry = options.registry ?? createWorkspaceRegistry({ env });
  const resolved = await createTargetResolver({
    workspaceCatalog: registry,
  }).resolve({
    input: options.input,
    ...(options.messageTs ? { messageTs: options.messageTs } : {}),
    ...(options.threadTs ? { threadTs: options.threadTs } : {}),
    ...(selectedWorkspace !== undefined
      ? { explicitWorkspace: selectedWorkspace }
      : {}),
  });
  if (options.profile !== undefined) await registry.resolve(resolved.workspaceAlias, options.profile);
  const lease = options.profile === undefined
    ? await clientLeaseFactory(resolved.workspaceAlias, registry)
    : await clientLeaseFactory(resolved.workspaceAlias, registry, options.profile);

  return {
    ...lease,
    target: {
      channel: resolved.channelId,
      ...(resolved.messageTs ? { ts: resolved.messageTs } : {}),
      ...(resolved.threadTs ??
      (options.messageTs === undefined ? resolved.messageTs : undefined)
        ? {
            thread_ts:
              resolved.threadTs ??
              (options.messageTs === undefined ? resolved.messageTs : undefined),
          }
        : {}),
    },
  };
}

function legacyTarget(
  input: string,
  messageTs: string | undefined,
  threadTs: string | undefined,
): CliResolvedTarget {
  const parsed = parseSlackTarget(input);
  return {
    channel: parsed.channel,
    ts: messageTs ?? parsed.ts,
    thread_ts:
      threadTs ??
      parsed.thread_ts ??
      (messageTs === undefined ? parsed.ts : undefined),
  };
}

function isUrlInput(input: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input);
}

import type { Command } from "commander";
import {
  createWorkspaceRecord,
  createWorkspaceRegistry,
  type WorkspaceRegistry,
} from "../lib/workspace.js";
import {
  formatDefaultWorkspaceCleared,
  formatWorkspace,
  formatWorkspaceList,
  type WorkspaceOutputMode,
} from "../output/workspace.js";

export type WorkspaceCommandDependencies = {
  registryFactory: () => WorkspaceRegistry;
  writeOut: (line: string) => void;
  writeErr: (line: string) => void;
};

const defaultDependencies: WorkspaceCommandDependencies = {
  registryFactory: () => createWorkspaceRegistry(),
  writeOut: (line) => console.log(line),
  writeErr: (line) => console.error(line),
};

export function registerWorkspaceCommands(
  program: Command,
  dependencies: WorkspaceCommandDependencies = defaultDependencies,
): void {
  const workspace = program
    .command("workspace")
    .description("Manage Slack workspace registry entries (offline; does not call Slack)");

  const profile = workspace.command("profile").description("Manage named credential profiles offline");
  profile.command("add <selector> <name>")
    .option("--user-token-env <name>", "Environment variable name for the User token")
    .option("--bot-token-env <name>", "Environment variable name for the Bot token")
    .action(withErrors(dependencies, async (selector: string, name: string, options: { userTokenEnv?: string; botTokenEnv?: string }) => {
      const selected = await dependencies.registryFactory().addProfile(selector, name, {
        ...(options.userTokenEnv === undefined ? {} : { user: { provider: "environment", name: options.userTokenEnv } }),
        ...(options.botTokenEnv === undefined ? {} : { bot: { provider: "environment", name: options.botTokenEnv } }),
      });
      dependencies.writeOut(formatWorkspace(selected, outputMode(program)));
    }));
  profile.command("list <selector>")
    .action(withErrors(dependencies, async (selector: string) => {
      const profiles = await dependencies.registryFactory().listProfiles(selector);
      const mode = outputMode(program);
      dependencies.writeOut(mode === "json" ? JSON.stringify(profiles, null, 2) :
        profiles.map((item) => item.name).join("\n"));
    }));
  profile.command("remove <selector> <name>")
    .action(withErrors(dependencies, async (selector: string, name: string) => {
      const selected = await dependencies.registryFactory().removeProfile(selector, name);
      dependencies.writeOut(formatWorkspace(selected, outputMode(program)));
    }));

  workspace
    .command("list")
    .description("List registered workspaces")
    .action(
      withErrors(dependencies, async () => {
        const output = formatWorkspaceList(
          await dependencies.registryFactory().list(),
          outputMode(program),
        );
        if (output !== "") dependencies.writeOut(output);
      }),
    );

  workspace
    .command("add")
    .description("Add a workspace using its Slack Team ID")
    .requiredOption("--team-id <id>", "Slack Team ID (canonical identifier)")
    .requiredOption("--alias <alias>", "Unique local alias")
    .requiredOption("--domain <domain>", "Current workspace domain")
    .requiredOption("--name <name>", "Display name")
    .option("--previous-domain <domain...>", "Previous workspace domain")
    .option("--user-token-env <name>", "Environment variable name for the User token")
    .option("--bot-token-env <name>", "Environment variable name for the Bot token")
    .option("--default", "Set this workspace as default")
    .action(
      withErrors(dependencies, async (options: AddWorkspaceOptions) => {
        const record = toWorkspaceRecord(options);
        const added = await dependencies
          .registryFactory()
          .add(record, { makeDefault: Boolean(options.default) });
        dependencies.writeOut(formatWorkspace(added, outputMode(program)));
      }),
    );

  workspace
    .command("show [selector]")
    .description("Show a workspace by Team ID, alias, domain, or the configured default")
    .action(
      withErrors(dependencies, async (selector?: string) => {
        const selected = await dependencies.registryFactory().resolve(selector);
        dependencies.writeOut(formatWorkspace(selected, outputMode(program)));
      }),
    );

  workspace
    .command("remove <selector>")
    .description("Remove a workspace by Team ID, alias, or domain")
    .action(
      withErrors(dependencies, async (selector: string) => {
        const removed = await dependencies.registryFactory().remove(selector);
        dependencies.writeOut(formatWorkspace(removed, outputMode(program)));
      }),
    );

  workspace
    .command("default [selector]")
    .description("Set or clear the default workspace")
    .option("--clear", "Clear the default workspace")
    .action(
      withErrors(
        dependencies,
        async (selector: string | undefined, options: { clear?: boolean }) => {
          const registry = dependencies.registryFactory();
          if (options.clear) {
            if (selector !== undefined) {
              throw new Error("Do not provide a selector with --clear");
            }
            await registry.clearDefault();
            dependencies.writeOut(formatDefaultWorkspaceCleared(outputMode(program)));
            return;
          }
          if (selector === undefined) {
            throw new Error("A workspace selector or --clear is required");
          }
          const selected = await registry.setDefault(selector);
          dependencies.writeOut(formatWorkspace(selected, outputMode(program)));
        },
      ),
    );
}

type AddWorkspaceOptions = {
  teamId: string;
  alias: string;
  domain: string;
  name: string;
  previousDomain?: string[];
  userTokenEnv?: string;
  botTokenEnv?: string;
  default?: boolean;
};

function toWorkspaceRecord(options: AddWorkspaceOptions) {
  return createWorkspaceRecord({
    teamId: options.teamId,
    alias: options.alias,
    domain: options.domain,
    previousDomains: options.previousDomain,
    displayName: options.name,
    userTokenEnv: options.userTokenEnv,
    botTokenEnv: options.botTokenEnv,
  });
}

function outputMode(program: Command): WorkspaceOutputMode {
  const options = program.opts<{ json?: boolean; plain?: boolean }>();
  if (options.json) return "json";
  if (options.plain) return "plain";
  return "human";
}

function withErrors<TArgs extends unknown[]>(
  dependencies: WorkspaceCommandDependencies,
  action: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace command failed";
      dependencies.writeErr(`Error: ${message}`);
      process.exitCode = 1;
    }
  };
}

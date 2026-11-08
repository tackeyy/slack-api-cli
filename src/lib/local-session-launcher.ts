import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { LocalSessionConnection } from "./local-session-web-client.js";

const START_TIMEOUT_MS = 10_000;

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export async function launchLocalSessionDaemon(
  input: {
    readonly cliPath: string;
    readonly executablePath: string;
    /** 親プロセスの `process.execArgv`。tsx などのローダー指定だけを daemon へ引き継ぐ。 */
    readonly execArgv?: readonly string[];
    readonly token: string;
    readonly profile?: string;
    readonly configHome: string;
    readonly connection: LocalSessionConnection;
  },
  spawnProcess: SpawnProcess = spawn,
): Promise<{ readonly pid: number }> {
  const child = spawnProcess(
    input.executablePath,
    [...daemonLoaderArguments(input.execArgv ?? []), input.cliPath, "__session-daemon"],
    {
    detached: true,
    stdio: ["pipe", "pipe", "ignore"],
    env: safeDaemonEnvironment(process.env),
    },
  );
  if (!child.stdin || !child.stdout) {
    child.kill();
    throw new Error("Local session daemon did not provide secure pipes");
  }

  const ready = waitForReady(child);
  child.stdin.end(
    `${JSON.stringify({
      version: 1,
      ...(input.profile === undefined ? {} : { profile: input.profile }),
      token: input.token,
      configHome: input.configHome,
      connection: input.connection,
    })}\n`,
  );
  await ready;
  const pid = child.pid;
  if (!pid) {
    child.kill();
    throw new Error("Local session daemon did not start");
  }
  child.stdout.destroy();
  child.unref();
  return Object.freeze({ pid });
}

const LOADER_FLAGS = new Set(["--require", "-r", "--import", "--loader", "--experimental-loader"]);

/**
 * daemon へ引き継ぐ Node のフラグを、モジュールローダーの指定だけに絞る。
 * ソース直実行（tsx）では、これが無いと daemon が `.ts` を読めずに起動できない。
 * daemon は token を保持するので、デバッガ・eval などの他のフラグは引き継がない。
 */
export function daemonLoaderArguments(execArgv: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < execArgv.length; index += 1) {
    const flag = execArgv[index]!;
    const equals = flag.indexOf("=");
    if (equals > 0) {
      if (LOADER_FLAGS.has(flag.slice(0, equals)) && equals < flag.length - 1) kept.push(flag);
      continue;
    }
    if (!LOADER_FLAGS.has(flag)) continue;
    const value = execArgv[index + 1];
    if (value === undefined || value.startsWith("-")) continue;
    kept.push(flag, value);
    index += 1;
  }
  return kept;
}

function waitForReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdout = child.stdout!;
    let output = "";
    const timeout = setTimeout(() => fail(), START_TIMEOUT_MS);
    timeout.unref();
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 64 || !output.includes("\n")) return;
      if (output.slice(0, output.indexOf("\n")) !== "READY") return fail();
      cleanup();
      resolve();
    };
    const onExit = () => fail();
    const onError = () => fail();
    const fail = () => {
      cleanup();
      child.kill();
      reject(new Error("Local session daemon failed to start"));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      stdout.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    stdout.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function safeDaemonEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...(env.LANG ? { LANG: env.LANG } : {}),
    ...(env.LC_ALL ? { LC_ALL: env.LC_ALL } : {}),
    ...(env.TZ ? { TZ: env.TZ } : {}),
  };
}

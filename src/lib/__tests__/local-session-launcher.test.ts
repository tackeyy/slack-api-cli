import { SlackAuthTestVerifier } from "../../slack/auth-test-verifier.js";
import * as sessionFiles from "../local-session-files.js";
import * as sessionBroker from "../local-session-broker.js";
import { runLocalSessionDaemon, runLocalSessionDaemonFromStdin } from "../local-session-daemon.js";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi, type MockInstance } from "vitest";
import { parseTeamId } from "../../domain/team-id.js";
import { daemonLoaderArguments, launchLocalSessionDaemon } from "../local-session-launcher.js";

describe("local session daemon launcher", () => {
  it.each([undefined, "a"])("passes a %s profile and token over stdin without changing the connection or argv", async (profile) => {
    let stdinText = "";
    const stdin = new Writable({
      write(chunk, _encoding, callback) {
        stdinText += chunk.toString();
        callback();
      },
    });
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdin,
      stdout,
      pid: 4321,
      unref: vi.fn(),
      kill: vi.fn(),
    });
    const spawnProcess = vi.fn().mockReturnValue(child);
    const token = "xoxp-launch-secret-canary";
    const launching = launchLocalSessionDaemon(
      {
        cliPath: "/opt/slamy/dist/cli/index.js",
        executablePath: "/opt/node/bin/node",
        token,
        ...(profile === undefined ? {} : { profile }),
        configHome: "/private/config",
        connection: {
          version: 1,
          teamId: parseTeamId("T0BJ9SG2M0R"),
          credentialKind: "user",
          socketPath: sessionFiles.resolveLocalSessionPaths({ configHome: "/private/config",
            teamId: "T0BJ9SG2M0R", credentialKind: "user", ...(profile === undefined ? {} : { profile }) }).socketPath,
          capability: "local-capability-canary",
          createdAt: "2029-01-01T00:00:00.000Z",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
      },
      spawnProcess,
    );
    stdout.write("READY\n");

    await expect(launching).resolves.toEqual({ pid: 4321 });
    const [, argv, options] = spawnProcess.mock.calls[0];
    expect(JSON.stringify(argv)).not.toContain(token);
    expect(JSON.stringify(options.env)).not.toContain(token);
    expect(stdinText.match(new RegExp(token, "g"))).toHaveLength(1);
    expect(child.unref).toHaveBeenCalledOnce();
    const bootstrap = JSON.parse(stdinText);
    expect(bootstrap.profile).toBe(profile);
    expect(Object.hasOwn(bootstrap, "profile")).toBe(profile !== undefined);
    expect(bootstrap.connection).not.toHaveProperty("profile");
    expect(argv).toEqual(["/opt/slamy/dist/cli/index.js", "__session-daemon"]);
    await withDaemonFixture(bootstrap, async ({ verify, broker }) => {
      verify.mockResolvedValue({ teamId: parseTeamId("T0BJ9SG2M0R"), userId: "U1" });
      await runLocalSessionDaemonFromStdin();
      expect(broker).toHaveBeenCalledWith(expect.objectContaining({ connection: bootstrap.connection }));
    });
  });
});

describe("daemonLoaderArguments", () => {
  it("keeps the module loader flags that tsx needs to run the source CLI", () => {
    expect(
      daemonLoaderArguments([
        "--require",
        "/n/tsx/dist/preflight.cjs",
        "--import",
        "file:///n/tsx/dist/loader.mjs",
      ]),
    ).toEqual([
      "--require",
      "/n/tsx/dist/preflight.cjs",
      "--import",
      "file:///n/tsx/dist/loader.mjs",
    ]);
    expect(daemonLoaderArguments(["--import=tsx", "-r", "a.cjs", "--loader", "x.mjs"])).toEqual([
      "--import=tsx",
      "-r",
      "a.cjs",
      "--loader",
      "x.mjs",
    ]);
  });

  it("drops debugger, eval and unknown flags so the daemon holding the token cannot be inspected", () => {
    expect(
      daemonLoaderArguments([
        "--inspect",
        "--inspect-brk=9229",
        "--inspect-port",
        "9230",
        "--debug-port=1",
        "--eval",
        "x",
        "-e",
        "y",
        "--print",
        "--expose-gc",
        "--require",
        "a.cjs",
      ]),
    ).toEqual(["--require", "a.cjs"]);
  });

  it("drops a loader flag whose value is missing or is another flag", () => {
    expect(daemonLoaderArguments(["--import"])).toEqual([]);
    expect(daemonLoaderArguments(["--import", "--inspect"])).toEqual([]);
    expect(daemonLoaderArguments(["--import="])).toEqual([]);
    expect(daemonLoaderArguments([])).toEqual([]);
  });

  it("passes the loader flags before the CLI path when spawning", async () => {
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout,
      pid: 1,
      unref: vi.fn(),
      kill: vi.fn(),
    });
    const spawnProcess = vi.fn().mockReturnValue(child);
    const launching = launchLocalSessionDaemon(
      {
        cliPath: "/opt/slamy/src/cli/index.ts",
        executablePath: "/opt/node/bin/node",
        execArgv: ["--inspect", "--import", "file:///tsx/loader.mjs"],
        token: "xoxp-t",
        configHome: "/c",
        connection: {
          version: 1,
          teamId: parseTeamId("T0BJ9SG2M0R"),
          credentialKind: "user",
          socketPath: "/tmp/s.sock",
          capability: "cap",
          createdAt: "2029-01-01T00:00:00.000Z",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
      },
      spawnProcess,
    );
    stdout.write("READY\n");
    await launching;
    expect(spawnProcess.mock.calls[0][1]).toEqual([
      "--import",
      "file:///tsx/loader.mjs",
      "/opt/slamy/src/cli/index.ts",
      "__session-daemon",
    ]);
  });
});

const daemonConnection = {
  version: 1 as const,
  teamId: parseTeamId("TPROFILE1"),
  credentialKind: "user" as const,
  socketPath: "",
  capability: "fixture-capability-canary",
  createdAt: "2029-01-01T00:00:00.000Z",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

async function withDaemonFixture(body: unknown, check: (deps: {
  verify: MockInstance<SlackAuthTestVerifier["verify"]>;
  prepare: MockInstance<typeof sessionFiles.prepareLocalSessionPaths>;
  broker: MockInstance<typeof sessionBroker.startLocalSessionBroker>;
  stdout: MockInstance<typeof process.stdout.write>;
}) => Promise<void>) {
  const title = process.title;
  const signals = ["SIGTERM", "SIGINT"] as const;
  const before = signals.map((signal) => new Set(process.listeners(signal)));
  const stdin = vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () {
    yield Buffer.from(JSON.stringify(body));
    return undefined;
  });
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const verify = vi.spyOn(SlackAuthTestVerifier.prototype, "verify").mockResolvedValue({ teamId: daemonConnection.teamId, userId: "U1" });
  const prepare = vi.spyOn(sessionFiles, "prepareLocalSessionPaths").mockImplementation(async (input) => sessionFiles.resolveLocalSessionPaths(input));
  const broker = vi.spyOn(sessionBroker, "startLocalSessionBroker").mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });
  try { await check({ verify, prepare, broker, stdout }); }
  finally {
    stdin.mockRestore(); stdout.mockRestore(); verify.mockRestore(); prepare.mockRestore(); broker.mockRestore();
    process.title = title;
    signals.forEach((signal, index) => {
      for (const listener of process.listeners(signal)) if (!before[index]!.has(listener)) process.removeListener(signal, listener);
    });
  }
}

describe("daemon bootstrap profiles", () => {
  it.each([undefined, "a"])("accepts profile %s from stdin with the matching socket", async (profile) => {
    const paths = sessionFiles.resolveLocalSessionPaths({ configHome: "/fixture/config", teamId: daemonConnection.teamId,
      credentialKind: "user", ...(profile === undefined ? {} : { profile }) });
    const body = { version: 1, token: "xoxp-fixture-only", configHome: "/fixture/config",
      ...(profile === undefined ? {} : { profile }), connection: { ...daemonConnection, socketPath: paths.socketPath } };
    await withDaemonFixture(body, async ({ prepare, broker, stdout }) => {
      await runLocalSessionDaemonFromStdin();
      expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ ...(profile === undefined ? {} : { profile }) }));
      expect(broker).toHaveBeenCalledWith(expect.objectContaining({ paths,
        connection: body.connection }));
      expect(stdout).toHaveBeenCalledWith("READY\n");
      expect(process.title).toBe(`slamy-session:TPROFILE1:user${profile === undefined ? "" : `:${profile}`}`);
    });
  });
  it.each(["default", "../a", "", "A", "a".repeat(33), null, 1, {}, []])(
    "rejects an invalid profile before verification or filesystem access", async (profile) => {
      const body = { version: 1, token: "xoxp-fixture-only", configHome: "/fixture/config", profile,
        connection: { ...daemonConnection, socketPath: "/fixture/session.sock" } };
      await withDaemonFixture(body, async ({ verify, prepare, broker, stdout }) => {
        await expect(runLocalSessionDaemonFromStdin()).rejects.toThrow("Workspace profile name is invalid");
        await expect(runLocalSessionDaemon(body as never)).rejects.toThrow("Workspace profile name is invalid");
        expect(verify).not.toHaveBeenCalled();
        expect(prepare).not.toHaveBeenCalled();
        expect(broker).not.toHaveBeenCalled();
        expect(stdout).not.toHaveBeenCalled();
      });
    });

  it.each([
    { profile: "a", socketProfile: undefined },
    { profile: undefined, socketProfile: "a" },
    { profile: "a", socketProfile: "b" },
  ])("rejects a socket belonging to a different profile", async ({ profile, socketProfile }) => {
    const paths = sessionFiles.resolveLocalSessionPaths({ configHome: "/fixture/config", teamId: daemonConnection.teamId,
      credentialKind: "user", ...(socketProfile === undefined ? {} : { profile: socketProfile }) });
    const body = { version: 1, token: "xoxp-fixture-only", configHome: "/fixture/config",
      ...(profile === undefined ? {} : { profile }), connection: { ...daemonConnection, socketPath: paths.socketPath } };
    await withDaemonFixture(body, async ({ broker, stdout }) => {
      await expect(runLocalSessionDaemonFromStdin()).rejects.toThrow("bootstrap path mismatch");
      expect(broker).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
    });
  });

});

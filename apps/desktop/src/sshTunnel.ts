import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as readline from "node:readline";

export interface SshTunnelConfig {
  host: string;
  user: string;
  port: number; // SSH port, default 22
  identityFile?: string | undefined;
  remoteProjectPath: string;
  remoteServerPort: number; // default 3773
  remoteBinary?: string | undefined; // default "t3"
}

export interface SshTunnelResult {
  localPort: number;
  authToken: string;
  wsUrl: string;
  remotePort: number;
  remotePid: number | null;
}

export interface SshTunnel {
  readonly config: SshTunnelConfig;
  readonly result: SshTunnelResult;
  readonly process: ChildProcess.ChildProcess;
  stop(): void;
  onExit(handler: (code: number | null, signal: string | null) => void): void;
}

/** POSIX sh single-quoted string (safe for remote shell word boundaries). */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function findSshBinary(): string {
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
      "C:\\Program Files\\Git\\usr\\bin\\ssh.exe",
    ];
    for (const candidate of candidates) {
      if (FS.existsSync(candidate)) return candidate;
    }
  }
  return "ssh"; // macOS/Linux: rely on PATH (already synced by syncShellEnvironment)
}

export function startSshTunnel(config: SshTunnelConfig, localPort: number): Promise<SshTunnel> {
  return new Promise((resolve, reject) => {
    const authToken = Crypto.randomBytes(24).toString("hex");
    const remotePort = config.remoteServerPort || 3773;
    const remoteBinary = config.remoteBinary || "t3";
    const sshBinary = findSshBinary();

    const remoteCommand = [
      `T3CODE_AUTH_TOKEN=${shSingleQuote(authToken)}`,
      shSingleQuote(remoteBinary),
      `--port`,
      `${remotePort}`,
      `--host`,
      `127.0.0.1`,
      `--no-browser`,
      `--print-ready-json`,
      shSingleQuote(config.remoteProjectPath),
    ].join(" ");

    const sshArgs = [
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ExitOnForwardFailure=yes",
      "-p",
      `${config.port || 22}`,
      "-L",
      `${localPort}:127.0.0.1:${remotePort}`,
      ...(config.identityFile ? ["-i", config.identityFile] : []),
      `${config.user}@${config.host}`,
      remoteCommand,
    ];

    const child = ChildProcess.spawn(sshBinary, sshArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error("SSH tunnel startup timed out after 30 seconds"));
      }
    }, 30_000);

    // Parse stdout for the ready JSON line
    if (child.stdout) {
      const rl = readline.createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        if (settled) return;
        try {
          const parsed = JSON.parse(line) as {
            ready?: unknown;
            port?: unknown;
            pid?: unknown;
          };
          if (parsed.ready === true) {
            settled = true;
            clearTimeout(timeout);
            rl.close();
            const parsedPort =
              typeof parsed.port === "number"
                ? parsed.port
                : typeof parsed.port === "string"
                  ? Number(parsed.port)
                  : remotePort;
            const parsedPid =
              typeof parsed.pid === "number"
                ? parsed.pid
                : typeof parsed.pid === "string"
                  ? Number(parsed.pid)
                  : null;
            const result: SshTunnelResult = {
              localPort,
              authToken,
              wsUrl: `ws://127.0.0.1:${localPort}/?token=${encodeURIComponent(authToken)}`,
              remotePort: Number.isFinite(parsedPort) ? parsedPort : remotePort,
              remotePid:
                parsedPid !== null && Number.isFinite(parsedPid) ? Math.trunc(parsedPid) : null,
            };
            const tunnel: SshTunnel = {
              config,
              result,
              process: child,
              stop() {
                if (child.exitCode === null && child.signalCode === null) {
                  child.kill("SIGTERM");
                  setTimeout(() => {
                    if (child.exitCode === null && child.signalCode === null) {
                      child.kill("SIGKILL");
                    }
                  }, 2_000).unref();
                }
              },
              onExit(handler) {
                child.on("exit", handler);
              },
            };
            resolve(tunnel);
          }
        } catch {
          // Not JSON, ignore (could be SSH banner or remote shell output)
        }
      });
    }

    // Collect stderr output for error reporting
    let stderrOutput = "";
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });
    }

    // Handle early failure
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`SSH process error: ${err.message}`));
      }
    });

    child.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        setTimeout(() => {
          reject(
            new Error(
              `SSH process exited before server was ready (code=${code}, signal=${signal})${stderrOutput ? `: ${stderrOutput.trim()}` : ""}`,
            ),
          );
        }, 100);
      }
    });
  });
}

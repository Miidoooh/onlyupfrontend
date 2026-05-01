/**
 * Spawn dev:api + dev:worker concurrently with colored, prefixed output.
 *
 *   npm run dev:all         # api + worker
 *   npm run dev:all -- --tunnel    # api + worker + cloudflare quick tunnel
 *
 * Why this exists: after a fresh deploy you have to restart the API (so it
 * reads the new BOUNTY_HOOK_ADDRESS / chainReader cache) and the worker (so
 * it re-indexes from WORKER_START_BLOCK). Two terminals, two ctrl+c, two
 * `npm run`. This script wraps them as one.
 *
 * Behavior:
 *  - Each child gets a colored [api] / [worker] / [tunnel] prefix.
 *  - Ctrl+C kills the whole tree.
 *  - If any child exits non-zero, the script exits with that code (the
 *    others are torn down first).
 *  - With `--tunnel`, also spawns `cloudflared tunnel --url http://localhost:4311`
 *    and prints any auto-detected trycloudflare URL so you can paste it into
 *    NEXT_PUBLIC_API_URL.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const COLORS = {
  api:    "\x1b[36m", // cyan
  worker: "\x1b[33m", // yellow
  tunnel: "\x1b[35m", // magenta
  reset:  "\x1b[0m",
  red:    "\x1b[31m",
  dim:    "\x1b[2m"
};

const useColor = process.stdout.isTTY;
const wrap = (s, k) => (useColor ? `${COLORS[k] ?? ""}${s}${COLORS.reset}` : s);

const wantTunnel = process.argv.includes("--tunnel");
const isWin = process.platform === "win32";

function startChild(name, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: repoRoot,
    env: process.env,
    shell: isWin, // npm.cmd / cloudflared shim on Windows need a shell
    stdio: ["ignore", "pipe", "pipe"]
  });

  const prefix = wrap(`[${name}]`.padEnd(8), name);

  function pipe(stream) {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (name === "tunnel") detectTunnelUrl(line);
        process.stdout.write(`${prefix} ${line}\n`);
      }
    });
    stream.on("end", () => {
      if (buf.length > 0) process.stdout.write(`${prefix} ${buf}\n`);
    });
  }
  pipe(child.stdout);
  pipe(child.stderr);

  child.on("exit", (code, signal) => {
    process.stdout.write(`${prefix} ${wrap(`exited code=${code} signal=${signal ?? "-"}`, "dim")}\n`);
    teardown(code ?? 1);
  });

  return child;
}

let tunnelUrlPrinted = false;
function detectTunnelUrl(line) {
  // cloudflared prints a line like:  https://<random>.trycloudflare.com
  const m = line.match(/https?:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (m && !tunnelUrlPrinted) {
    tunnelUrlPrinted = true;
    const url = m[0];
    process.stdout.write(
      `${wrap("[tunnel]", "tunnel")} ${wrap("public URL:", "dim")} ${url}\n` +
      `${wrap("[tunnel]", "tunnel")} ${wrap("→ paste into NEXT_PUBLIC_API_URL in .env, then run:", "dim")} npm run vercel:sync\n`
    );
  }
}

const children = [];
let tearingDown = false;
function teardown(code) {
  if (tearingDown) return;
  tearingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      try { child.kill(isWin ? "SIGTERM" : "SIGINT"); } catch {}
    }
  }
  // Give children a moment to flush, then exit.
  setTimeout(() => process.exit(code), 250);
}

process.on("SIGINT", () => teardown(0));
process.on("SIGTERM", () => teardown(0));

const npm = isWin ? "npm.cmd" : "npm";
children.push(startChild("api",    npm, ["run", "dev:api"]));
children.push(startChild("worker", npm, ["run", "dev:worker"]));

if (wantTunnel) {
  // Cloudflared isn't a hard dep — only spawn if user opted in.
  const cloudflared = isWin ? "cloudflared.exe" : "cloudflared";
  const port = process.env.API_PORT || "4311";
  process.stdout.write(`${wrap("[tunnel]", "tunnel")} ${wrap("starting cloudflare quick tunnel on", "dim")} http://localhost:${port}\n`);
  children.push(startChild("tunnel", cloudflared, ["tunnel", "--url", `http://localhost:${port}`]));
}

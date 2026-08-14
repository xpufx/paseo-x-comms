#!/usr/bin/env node
// Hermetic stand-in for the paseo CLI. Only used by tests via PASEO_CROSS_DAEMON_COMMS_PASEO.
// Never called by the real tool outside of tests.
//
// Test controls via env:
//   FAKE_PASEO_DELAY_MS  respond after a delay (tests cancellation / exit discipline)
//   FAKE_PASEO_FAIL      exit 1 with this message on stderr (tests error paths)
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const delay = Number(process.env.FAKE_PASEO_DELAY_MS || 0);
const fail = process.env.FAKE_PASEO_FAIL;

function argAfter(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
}

const sub = args[0];
const host = argAfter("--host");
const prompt = args[args.length - 1];

function respond(data) {
  if (delay > 0) {
    // Keep the event loop alive across the delay; SIGTERM still kills us (no
    // signal listener installed), which is what the cancellation test relies on.
    sleep(delay).then(() => write(data));
  } else {
    write(data);
  }
}
function write(data) {
  process.stdout.write(JSON.stringify(data) + "\n");
}

if (fail) {
  console.error(fail);
  process.exit(1);
}

switch (sub) {
  case "daemon":
    respond({ serverId: "srv_fake", hostname: "fakehost" });
    break;
  case "inspect":
    respond({ Id: args[1], Name: "fake-agent", sawHost: host });
    break;
  case "ls":
    respond([{ id: "agent-1", shortId: "agent-1", name: "fake-agent", status: "idle", sawHost: host }]);
    break;
  case "send":
    respond({ ok: true, to: args[1], sawHost: host, sawNoWait: args.includes("--no-wait"), promptHead: prompt });
    break;
  case "logs":
    respond({ events: [], sawHost: host });
    break;
  case "wait":
    respond({
      agentId: args[1],
      status: process.env.FAKE_PASEO_WAIT_STATUS || "idle",
      message: process.env.FAKE_PASEO_WAIT_STATUS === "permission"
        ? "Agent is waiting for permission: external_directory"
        : "Agent is idle.",
      sawHost: host,
      sawTimeout: argAfter("--timeout"),
    });
    break;
  case "permit": {
    const sub = args[1];
    if (sub === "ls") {
      respond(process.env.FAKE_PASEO_PERMISSIONS ? JSON.parse(process.env.FAKE_PASEO_PERMISSIONS) : []);
    } else if (sub === "allow" || sub === "deny") {
      // positional agent is args[2]; positional reqId is args[3] (if no options before it)
      const positionals = args.slice(2).filter((a) => !a.startsWith("-"));
      const item = {
        requestId: positionals[1] ?? "all",
        agentId: positionals[0],
        result: sub === "allow" ? "allowed" : "denied",
        sawHost: host,
        sawAll: args.includes("--all"),
      };
      respond(sub === "allow" ? [item] : { data: [item] });
    } else {
      console.error(`fake-paseo: unhandled permit subcommand: ${sub}`);
      process.exit(1);
    }
    break;
  }
  default:
    console.error(`fake-paseo: unhandled args: ${args.join(" ")}`);
    process.exit(1);
}

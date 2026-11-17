import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SpotlightEvents } from "./spotlight-events.mjs";

const exec = promisify(execFile);
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const statePath = process.env.SPOTLIGHT_LISTENER_STATE;
if (!base || !apikey || !statePath) throw new Error("Publication listener configuration is incomplete.");
let state = { jobs: {} };
try { state = JSON.parse(await readFile(statePath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }

async function save() {
  state.updatedAt = new Date().toISOString();
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(`${statePath}.tmp`, JSON.stringify(state, null, 2) + "\n");
  await rename(`${statePath}.tmp`, statePath);
}
async function notify(message) {
  console.error(message);
  try { await exec("/usr/bin/osascript", ["-e", `display notification ${JSON.stringify(message)} with title "Hire Line Dancers"`], { timeout: 10000 }); }
  catch { console.error("Unable to display the local publication alert."); }
}
const gh = async args => (await exec(process.env.GH_BIN || "gh", args, { timeout: 30000 })).stdout;
async function read(table, params) {
  const url = new URL(`/rest/v1/${table}`, base);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { headers: { apikey }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Publication event data HTTP ${response.status}.`);
  return response.json();
}
const publisher = new SpotlightEvents({ state, save, notify,
  readArticle: async id => (await read("instructor_spotlights", { select: "*", profile_id: `eq.${id}`, status: "eq.released" }))[0],
  dispatch: id => gh(["workflow", "run", "deploy.yml", "--repo", "cjwheelock/hirelinedancers", "--ref", "main", "--field", `spotlight_event_id=${id}`]),
  findDispatch: async id => JSON.parse(await gh(["run", "list", "--repo", "cjwheelock/hirelinedancers", "--workflow", "deploy.yml", "--branch", "main", "--limit", "50", "--json", "displayTitle"])).some(run => run.displayTitle === `Deploy to GitHub Pages ${id}`)
});
await publisher.recover();

let queue = Promise.resolve();
let timer;
function schedule() {
  clearTimeout(timer);
  const times = Object.values(state.jobs).flatMap(job => [
    ...(['pending', 'attempting'].includes(job.dispatch.status) ? [Date.parse(job.dispatch.retryAt || job.event.occurred_at)] : []),
    ...(job.verification.status === "pending" ? [Date.parse(job.verification.at)] : [])
  ]).filter(Number.isFinite);
  if (times.length) timer = setTimeout(() => enqueue(async () => {
    for (const id of Object.keys(state.jobs)) {
      await publisher.publish(id);
      await publisher.verifyDue(id);
    }
  }), Math.max(0, Math.min(2147483647, Math.min(...times) - Date.now())));
}
function enqueue(action) {
  queue = queue.then(action).then(schedule).catch(async error => {
    state.error = error.message;
    await save();
    await notify("The spotlight event listener encountered an error. Check its status file.");
    // Exit and let launchd reconnect and replay the durable event table.
    process.exit(1);
  });
}
schedule();

const client = createClient(base, apikey, { auth: { persistSession: false, autoRefreshToken: false },
  realtime: { reconnectAfterMs: attempt => Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)) } });
client.channel("spotlight-publication-listener")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "spotlight_publication_events" },
    payload => enqueue(() => publisher.accept(payload.new)))
  .subscribe(status => enqueue(async () => {
    state.connection = status;
    await save();
    if (status !== "SUBSCRIBED") {
      if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status) && !state.connectionAlerted) {
        state.connectionAlerted = true;
        await save();
        await notify("The spotlight event listener is disconnected. It will reconnect and recover pending releases.");
      }
      return;
    }
    state.connectionAlerted = false;
    delete state.error;
    // One replay on connection/reconnection closes the offline-delivery gap. No polling.
    let cursor;
    for (;;) {
      const events = await read("spotlight_publication_events", { select: "*", order: "id", limit: "200", ...(cursor ? { id: `gt.${cursor}` } : {}) });
      for (const event of events) await publisher.accept(event);
      if (events.length < 200) break;
      cursor = events.at(-1).id;
    }
    state.lastReplayAt = new Date().toISOString();
    await save();
    console.log(`Subscribed to spotlight release events; ${Object.keys(state.jobs).length} durable event receipts.`);
  }));

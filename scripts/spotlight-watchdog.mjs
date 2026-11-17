import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { publicationProblems, releasedSpotlights } from "./spotlight-publication.mjs";

export function dispatchDecision(runs, now = Date.now()) {
  const active = runs.find(run => run.status !== "completed");
  if (active) {
    if (now - Date.parse(active.createdAt) > 30 * 60000) throw new Error(`Deployment ${active.databaseId} has been active for over 30 minutes.`);
    return "deployment-active";
  }
  if (runs.some(run => now - Date.parse(run.createdAt) < 10 * 60000)) return "deployment-cooldown";
  if (runs.filter(run => now - Date.parse(run.createdAt) < 3600000).length >= 3) {
    throw new Error("Three deployments in the last hour; publication is still incomplete. Inspect failed deployments.");
  }
  return "dispatch";
}

export async function watchdog({ gh, force = false, base, apikey, previous = {}, now = Date.now(), readRows = releasedSpotlights, verify = publicationProblems }) {
  const rows = await readRows({ base, apikey });
  const problems = await verify(rows);
  const result = { checkedAt: new Date(now).toISOString(), articles: rows.length, problems,
    firstDetectedAt: problems.length ? previous.firstDetectedAt || new Date(now).toISOString() : null };
  if (!problems.length && !force) return { ...result, action: "verified" };
  const runs = JSON.parse(gh(["run", "list", "--repo", "cjwheelock/hirelinedancers", "--workflow", "deploy.yml", "--branch", "main", "--limit", "30", "--json", "databaseId,status,conclusion,createdAt"]));
  const action = dispatchDecision(runs, now);
  if (action === "dispatch") gh(["workflow", "run", "deploy.yml", "--repo", "cjwheelock/hirelinedancers", "--ref", "main"]);
  return { ...result, action };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const statePath = process.env.SPOTLIGHT_WATCHDOG_STATE;
  let previous = {};
  if (statePath) {
    try { previous = JSON.parse(await readFile(statePath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  let result;
  try {
    result = await watchdog({
      base: process.env.NEXT_PUBLIC_SUPABASE_URL, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      previous, force: process.argv.includes("--force"),
      gh: args => execFileSync(process.env.GH_BIN || "gh", args, { encoding: "utf8", timeout: 30000 })
    });
    if (result.firstDetectedAt && Date.now() - Date.parse(result.firstDetectedAt) > 30 * 60000) {
      result.overdue = true;
      process.exitCode = 1;
    }
  } catch (error) {
    result = { ...previous, checkedAt: new Date().toISOString(), firstDetectedAt: previous.firstDetectedAt || new Date().toISOString(), error: error.message, action: "error" };
    process.exitCode = 1;
  }
  if (process.env.SPOTLIGHT_WATCHDOG_NOTIFY === "1" && process.exitCode
    && Date.now() - Date.parse(result.firstDetectedAt) > 30 * 60000
    && (!previous.lastNotifiedAt || Date.now() - Date.parse(previous.lastNotifiedAt) > 30 * 60000)) {
    try {
      execFileSync("/usr/bin/osascript", ["-e", 'display notification "Spotlight publication has been incomplete for over 30 minutes. Check the publication watchdog and GitHub deployment runs." with title "Hire Line Dancers"'], { timeout: 10000 });
      result.lastNotifiedAt = new Date().toISOString();
    } catch { console.error("Unable to display the local publication alert."); }
  } else if (result.firstDetectedAt) result.lastNotifiedAt = previous.lastNotifiedAt;
  if (statePath) {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(`${statePath}.tmp`, JSON.stringify(result, null, 2) + "\n");
    await rename(`${statePath}.tmp`, statePath);
  }
  console.log(JSON.stringify(result));
  if (process.exitCode) console.error("::error::Spotlight publication needs attention. Inspect the watchdog state and deployment runs.");
}

import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { publicationProblems } from "./spotlight-publication.mjs";

// Verify the exact snapshot built by this deployment, not a moving database target.
const rows = JSON.parse(await readFile("tmp/released-spotlights.json", "utf8"));
const attempts = process.argv.includes("--retry") ? 12 : 1;
for (let attempt = 1; attempt <= attempts; attempt++) {
  let problems;
  try { problems = await publicationProblems(rows); }
  catch (error) { problems = [error.message]; }
  if (!problems.length) {
    console.log(`Verified ${rows.length} live spotlight articles, content, blog links, and release version.`);
    break;
  }
  console.error(`Publication verification ${attempt}/${attempts}:\n${problems.join("\n")}`);
  if (attempt === attempts) process.exitCode = 1;
  else await setTimeout(15000);
}

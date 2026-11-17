import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { publicationProblems, releasedSpotlights, spotlightVersion } from "./spotlight-publication.mjs";

const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const check = process.argv.includes("--check");
const configured = base || apikey || check || process.env.GITHUB_ACTIONS;
const rows = configured ? await releasedSpotlights({ base, apikey }) : [];
if (check) {
  const problems = await publicationProblems(rows);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${problems.length > 0}\n`);
  console.log(problems.length ? problems.join("\n") : "Spotlights are current and public.");
} else {
  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/released-spotlights.json", JSON.stringify(rows) + "\n");
  await writeFile("public/spotlights-version.json", JSON.stringify({ version: spotlightVersion(rows) }) + "\n");
  console.log(`Included ${rows.length} released spotlight(s).`);
}

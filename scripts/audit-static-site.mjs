import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, "out");
const failures = [];

function report(file, check, detail) {
  failures.push({ file: path.relative(projectRoot, file), check, detail });
}

async function collectHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectHtmlFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".html") ? [entryPath] : [];
  }));
  return nested.flat();
}

// The no-em-dash rule is for Hire Line Dancers' own writing. Instructors write their own
// bios, headlines, packages and captions, so their words are left exactly as they wrote them.
const emDash = /\u2014/;
const instructorText = new Set();
function collectInstructorText(value) {
  if (typeof value === "string") {
    if (emDash.test(value)) for (const line of value.split(/\r?\n/)) if (emDash.test(line)) instructorText.add(line);
  } else if (Array.isArray(value)) value.forEach(collectInstructorText);
  else if (value && typeof value === "object") Object.values(value).forEach(collectInstructorText);
}
const profilesFile = path.join(projectRoot, "tmp", "published-profiles.json");
if (existsSync(profilesFile)) collectInstructorText(JSON.parse(await readFile(profilesFile, "utf8")));

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function withoutInstructorText(html) {
  let result = html;
  for (const text of instructorText) {
    const json = JSON.stringify(text).slice(1, -1);
    for (const variant of [text, escapeHtml(text), json, JSON.stringify(json).slice(1, -1)]) {
      result = result.split(variant).join("");
    }
  }
  return result;
}

function attributesFrom(tag) {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function plainText(value) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:nbsp|#160|#x0*a0);/gi, " ")
    .trim();
}

function pageUrlFor(file) {
  const relative = path.relative(outputRoot, file).split(path.sep).join("/");
  if (relative === "index.html") return new URL("https://hirelinedancers.test/");
  if (relative.endsWith("/index.html")) {
    return new URL(`https://hirelinedancers.test/${relative.slice(0, -"index.html".length)}`);
  }
  return new URL(`https://hirelinedancers.test/${relative}`);
}

function possibleTargets(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    decodedPath = pathname;
  }

  const relative = decodedPath.replace(/^\/+/, "");
  const direct = path.join(outputRoot, relative);
  if (!relative) return [path.join(outputRoot, "index.html")];
  if (decodedPath.endsWith("/")) return [path.join(direct, "index.html")];
  if (path.extname(decodedPath)) return [direct];
  return [direct, `${direct}.html`, path.join(direct, "index.html")];
}

function isExternalReference(value) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}

function auditReference(file, pageUrl, attribute, value) {
  const reference = value.trim();
  if (attribute === "href" && reference === "#") {
    report(file, "dead link", 'href="#"');
    return;
  }
  if (!reference || reference.startsWith("#") || isExternalReference(reference)) return;

  let targetUrl;
  try {
    targetUrl = new URL(reference, pageUrl);
  } catch {
    report(file, "invalid internal URL", `${attribute}="${reference}"`);
    return;
  }
  const internalHosts = new Set([pageUrl.hostname, "hirelinedancers.com", "www.hirelinedancers.com"]);
  if (!internalHosts.has(targetUrl.hostname)) return;

  const targets = possibleTargets(targetUrl.pathname);
  if (!targets.some((target) => existsSync(target))) {
    report(file, "missing internal target", `${attribute}="${reference}"`);
  }
}

function auditHtml(file, html) {
  const pageUrl = pageUrlFor(file);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  if (!plainText(title)) report(file, "metadata", "missing or empty title");

  const description = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => attributesFrom(match[0]))
    .find((attributes) => attributes.get("name")?.toLowerCase() === "description")
    ?.get("content") ?? "";
  if (!plainText(description)) report(file, "metadata", "missing or empty description");

  const idCounts = new Map();
  for (const match of html.matchAll(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    const id = match[1] ?? match[2] ?? match[3];
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) report(file, "duplicate id", `id="${id}" appears ${count} times`);
  }

  for (const match of html.matchAll(/\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    auditReference(file, pageUrl, match[1].toLowerCase(), match[2] ?? match[3] ?? "");
  }

  if (/\u2014|&mdash;|&#0*8212;|&#x0*2014;/i.test(withoutInstructorText(html))) {
    report(file, "content style", "contains an em dash");
  }
}

if (!existsSync(outputRoot)) {
  console.error("Static audit could not find out/. Run npm run build first.");
  process.exit(1);
}

const htmlFiles = await collectHtmlFiles(outputRoot);
if (htmlFiles.length === 0) {
  console.error("Static audit found no generated HTML files in out/.");
  process.exit(1);
}

for (const file of htmlFiles.sort()) {
  auditHtml(file, await readFile(file, "utf8"));
}

if (failures.length > 0) {
  console.error(`Static site audit failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}:`);
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.check}: ${failure.detail}`);
  }
  process.exit(1);
}

console.log(`Static site audit passed for ${htmlFiles.length} HTML files.`);

// Reads blogs/*.md(x) (flat or folder format), builds posts.json into the build output.
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildManifest } from "./manifest-lib.mjs";
import { readEntries } from "./read-entries.mjs";

// Keep these in sync with docusaurus.config.ts (url + baseUrl).
const SITE_URL = "https://kushalkrishnappa.github.io";
const BASE_URL = "/blogs/";
const BLOG_DIR = "blogs";
const OUT_FILE = join("build", "posts.json");

if (!existsSync("build")) {
  throw new Error("build/ not found — run `docusaurus build` before generating the manifest");
}
const manifest = buildManifest(readEntries(BLOG_DIR), { siteUrl: SITE_URL, baseUrl: BASE_URL });
writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2));
console.log(`[manifest] wrote ${manifest.posts.length} post(s) to ${OUT_FILE}`);

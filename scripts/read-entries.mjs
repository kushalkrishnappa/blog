import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

// Reads blog posts in both flat-file (`blogs/2026-07-01-post.md`) and folder
// (`blogs/2026-07-01-post/index.md(x)`) formats. Returns [{ data, content, fileName }]
// where fileName carries the date-bearing name (file or folder) for date derivation.
export function readEntries(dir) {
  if (!existsSync(dir)) return [];
  const entries = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && /\.mdx?$/.test(e.name)) {
      const { data, content } = matter(readFileSync(join(dir, e.name), "utf8"));
      entries.push({ data, content, fileName: e.name });
    } else if (e.isDirectory()) {
      const inner = ["index.md", "index.mdx"]
        .map((n) => join(dir, e.name, n))
        .find((p) => existsSync(p));
      if (inner) {
        const { data, content } = matter(readFileSync(inner, "utf8"));
        entries.push({ data, content, fileName: e.name }); // folder name carries the date
      }
    }
  }
  return entries;
}

// Pure, testable helpers for building posts.json. No filesystem access here.

export function readingTime(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} min read`;
}

function normalizeDate(data, fileName) {
  if (typeof data.date === "string" && data.date) return data.date.slice(0, 10);
  if (data.date instanceof Date) return data.date.toISOString().slice(0, 10);
  const m = typeof fileName === "string" ? fileName.match(/^(\d{4}-\d{2}-\d{2})-/) : null;
  return m ? m[1] : "";
}

function joinUrl(siteUrl, baseUrl, slug) {
  const base = `${siteUrl}${baseUrl}`.replace(/\/+$/, "");
  return `${base}/${String(slug).replace(/^\/+/, "")}`;
}

// data: parsed frontmatter; content: post body; opts: { siteUrl, baseUrl, fileName }
export function toPost(data, content, opts) {
  const { siteUrl, baseUrl, fileName } = opts;
  if (typeof data.slug !== "string" || !data.slug) {
    throw new Error(`Post "${fileName ?? "?"}" is missing a required string \`slug\` in frontmatter`);
  }
  if (typeof data.title !== "string" || !data.title) {
    throw new Error(`Post "${fileName ?? "?"}" is missing a required string \`title\` in frontmatter`);
  }
  return {
    slug: data.slug,
    title: data.title,
    date: normalizeDate(data, fileName),
    summary: typeof data.description === "string" ? data.description : "",
    tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [],
    url: joinUrl(siteUrl, baseUrl, data.slug),
    readingTime: readingTime(content),
  };
}

// entries: [{ data, content, fileName }]; opts: { siteUrl, baseUrl }
export function buildManifest(entries, opts) {
  const posts = entries
    .filter((e) => e.data.draft !== true)
    .map((e) => toPost(e.data, e.content, { ...opts, fileName: e.fileName }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { generatedAt: new Date().toISOString(), posts };
}

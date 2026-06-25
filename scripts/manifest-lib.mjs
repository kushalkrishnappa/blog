// Pure, testable helpers for building posts.json. No filesystem access here.

export function readingTime(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} min read`;
}

// URL-safe slug: lowercase letters/digits in hyphen-separated groups (e.g. my-post-2).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeDate(data, fileName) {
  if (typeof data.date === "string" && data.date) return data.date.slice(0, 10);
  if (data.date instanceof Date) return data.date.toISOString().slice(0, 10);
  const m = typeof fileName === "string" ? fileName.match(/^(\d{4}-\d{2}-\d{2})-/) : null;
  return m ? m[1] : "";
}

function joinUrl(siteUrl, baseUrl, slug) {
  // Join and collapse duplicate slashes in the path, preserving the protocol's "//".
  return `${siteUrl}/${baseUrl}/${slug}`.replace(/([^:]\/)\/+/g, "$1");
}

function isDraft(data, fileName) {
  const d = data.draft;
  if (d === undefined || d === false) return false;
  if (d === true) return true;
  throw new Error(
    `Post "${fileName ?? "?"}" has a non-boolean \`draft\` value (${JSON.stringify(d)}); use \`draft: true\` or remove it`,
  );
}

// data: parsed frontmatter; content: post body; opts: { siteUrl, baseUrl, fileName }
export function toPost(data, content, opts) {
  const { siteUrl, baseUrl, fileName } = opts;
  if (typeof data.slug !== "string" || !data.slug) {
    throw new Error(`Post "${fileName ?? "?"}" is missing a required string \`slug\` in frontmatter`);
  }
  if (!SLUG_RE.test(data.slug)) {
    throw new Error(
      `Post "${fileName ?? "?"}" has an invalid \`slug\` "${data.slug}" — use lowercase letters, digits, and hyphens (e.g. my-post)`,
    );
  }
  if (typeof data.title !== "string" || !data.title) {
    throw new Error(`Post "${fileName ?? "?"}" is missing a required string \`title\` in frontmatter`);
  }
  const date = normalizeDate(data, fileName);
  if (!date) {
    throw new Error(
      `Post "${fileName ?? "?"}" is missing a \`date\` — add \`date: YYYY-MM-DD\` to frontmatter or prefix the filename with a date`,
    );
  }
  return {
    slug: data.slug,
    title: data.title,
    date,
    summary: typeof data.description === "string" ? data.description : "",
    tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [],
    url: joinUrl(siteUrl, baseUrl, data.slug),
    readingTime: readingTime(content),
  };
}

// entries: [{ data, content, fileName }]; opts: { siteUrl, baseUrl }
export function buildManifest(entries, opts) {
  const posts = entries
    .filter((e) => !isDraft(e.data, e.fileName))
    .map((e) => toPost(e.data, e.content, { ...opts, fileName: e.fileName }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { generatedAt: new Date().toISOString(), posts };
}

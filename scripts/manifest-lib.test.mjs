import { test } from "node:test";
import assert from "node:assert/strict";
import { readingTime, toPost, buildManifest } from "./manifest-lib.mjs";

const SITE = "https://kushalkrishnappa.github.io";
const BASE = "/blog/";

test("readingTime rounds up at ~200 wpm, min 1", () => {
  assert.equal(readingTime(""), "1 min read");
  assert.equal(readingTime("word ".repeat(400)), "2 min read");
});

test("toPost builds an absolute permalink from slug", () => {
  const post = toPost(
    { slug: "hello-world", title: "Hello", date: "2026-07-01", description: "Teaser", tags: ["a", "b"] },
    "x ".repeat(200),
    { siteUrl: SITE, baseUrl: BASE },
  );
  assert.equal(post.url, "https://kushalkrishnappa.github.io/blog/hello-world");
  assert.equal(post.slug, "hello-world");
  assert.equal(post.title, "Hello");
  assert.equal(post.date, "2026-07-01");
  assert.equal(post.summary, "Teaser");
  assert.deepEqual(post.tags, ["a", "b"]);
  assert.equal(post.readingTime, "1 min read");
});

test("toPost derives date from filename when frontmatter omits it", () => {
  const post = toPost(
    { slug: "x", title: "X", description: "" },
    "body",
    { siteUrl: SITE, baseUrl: BASE, fileName: "2026-03-02-x.md" },
  );
  assert.equal(post.date, "2026-03-02");
  const postMdx = toPost(
    { slug: "y", title: "Y", description: "" },
    "body",
    { siteUrl: SITE, baseUrl: BASE, fileName: "2026-04-05-y.mdx" },
  );
  assert.equal(postMdx.date, "2026-04-05");
});

test("toPost throws when a published post lacks slug or title", () => {
  assert.throws(() => toPost({ title: "No slug" }, "b", { siteUrl: SITE, baseUrl: BASE, fileName: "p.md" }));
  assert.throws(() => toPost({ slug: "no-title" }, "b", { siteUrl: SITE, baseUrl: BASE, fileName: "p.md" }));
});

test("buildManifest excludes drafts and sorts newest-first", () => {
  const entries = [
    { data: { slug: "old", title: "Old", date: "2026-01-01", description: "" }, content: "b", fileName: "old.md" },
    { data: { slug: "new", title: "New", date: "2026-05-01", description: "" }, content: "b", fileName: "new.md" },
    { data: { slug: "draft", title: "Draft", date: "2026-09-01", description: "", draft: true }, content: "b", fileName: "draft.md" },
  ];
  const manifest = buildManifest(entries, { siteUrl: SITE, baseUrl: BASE });
  assert.equal(typeof manifest.generatedAt, "string");
  assert.deepEqual(manifest.posts.map((p) => p.slug), ["new", "old"]);
});

test("buildManifest with no entries returns an empty posts array", () => {
  const m = buildManifest([], { siteUrl: SITE, baseUrl: BASE });
  assert.deepEqual(m.posts, []);
  assert.equal(typeof m.generatedAt, "string");
});

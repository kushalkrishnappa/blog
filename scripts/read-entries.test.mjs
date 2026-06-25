import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEntries } from "./read-entries.mjs";

test("readEntries reads flat .md/.mdx and folder index posts", () => {
  const dir = mkdtempSync(join(tmpdir(), "blog-"));
  try {
    writeFileSync(join(dir, "2026-01-01-flat.md"), "---\nslug: flat\ntitle: Flat\n---\nbody");
    writeFileSync(join(dir, "2026-02-01-mdxflat.mdx"), "---\nslug: mdxflat\ntitle: Mdx\n---\nbody");
    mkdirSync(join(dir, "2026-03-01-folder"));
    writeFileSync(join(dir, "2026-03-01-folder", "index.md"), "---\nslug: folder\ntitle: Folder\n---\nbody");
    const entries = readEntries(dir);
    const bySlug = Object.fromEntries(entries.map((e) => [e.data.slug, e]));
    assert.deepEqual(Object.keys(bySlug).sort(), ["flat", "folder", "mdxflat"]);
    assert.equal(bySlug.folder.fileName, "2026-03-01-folder"); // folder name carries the date
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readEntries returns [] for a missing directory", () => {
  assert.deepEqual(readEntries(join(tmpdir(), "does-not-exist-xyz-12345")), []);
});

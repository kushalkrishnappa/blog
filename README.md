# Kushal Krishnappa — Blog

A standalone [Docusaurus](https://docusaurus.io/) blog site. After each build it
generates `build/posts.json`, a manifest consumed by the
[portfolio site](https://github.com/kushalkrishnappa/portfolio) to render blog
cards. The deployed permalink for every post is
`https://kushalkrishnappa.github.io/blog/<slug>`, which is identical to the
`url` field written into the manifest.

---

## Local development

```bash
npm install          # install dependencies
npm start            # start dev server at http://localhost:3000/blog/
npm run build        # production build + generate build/posts.json
npm test             # run manifest-generator unit tests
```

---

## Authoring a post

### File location

Two formats are supported:

- **Flat file:** `blogs/YYYY-MM-DD-slug-name.md`
- **Folder format:** `blogs/YYYY-MM-DD-slug-name/index.md` (use when the post
  needs co-located assets such as images)

> **Note:** the content directory is `blogs/` (plural) but the deployed URL path
> is `/blog/` (singular). These are independent: the directory name is set by
> `path: 'blogs'` in `docusaurus.config.ts` and `BLOG_DIR` in
> `scripts/generate-manifest.mjs`, while the URL comes from the GitHub repo name
> via `baseUrl`. Renaming the directory requires updating both of those two
> settings and nothing else.

### Required frontmatter

> **Warning:** Every published post MUST have an explicit `slug` field.
> The manifest generator (`scripts/generate-manifest.mjs`) throws an error and
> aborts the build if `slug` is missing. This is intentional — the manifest
> `url` is derived from `slug`, so a missing slug means a broken portfolio link.

```yaml
---
slug: my-post-slug          # REQUIRED. Becomes the URL /blog/<slug>.
                            # Must be unique and URL-safe (lowercase, hyphens).
title: "My Post Title"      # REQUIRED.
date: 2026-01-15            # Recommended. Falls back to YYYY-MM-DD filename prefix if omitted.
description: "One sentence summary shown on the portfolio card."
tags: [systems, infra]      # Array of tags (inline; no tags.yml needed).
draft: true                 # Optional. Omit or set false to publish.
                            # draft: true excludes the post from the build and manifest.
---
```

### Field reference

| Field | Required | Notes |
|---|---|---|
| `slug` | **YES** | URL path segment: `/blog/<slug>`. Must be unique and URL-safe. |
| `title` | **YES** | Displayed on the page and in the manifest. |
| `date` | Recommended | ISO date (`YYYY-MM-DD`). Derived from filename prefix if absent. |
| `description` | No | Becomes the portfolio card summary (`summary` field in manifest). |
| `tags` | No | Inline array — no separate `tags.yml` required. |
| `draft` | No | `true` = excluded from build and `posts.json` manifest. |

### Truncate marker

Add `{/* truncate */}` in the body to control what appears as the excerpt on
list pages. Everything before the marker is the excerpt; everything after is
only on the full post page. Note: `.md` files in this repo are compiled as MDX
(Docusaurus v4 future flag), so the JSX comment form `{/* truncate */}` is
required — HTML comments (`<!-- truncate -->`) are not valid MDX and will cause
a build error.

---

## Deployment / first-time setup

1. Create a GitHub repo named **`blog`** (the *repo* must be `blog` — singular —
   so Pages serves at `/blog/`, matching the portfolio's `BLOG_MANIFEST_URL`.
   This is unrelated to the local `blogs/` content directory.)
2. Push this repo:
   ```bash
   git remote add origin git@github.com:kushalkrishnappa/blog.git && git push -u origin main
   ```
3. Repo Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. Repo Settings → Secrets and variables → Actions → New repository secret:
   `NETLIFY_BUILD_HOOK` = the build hook URL from Netlify (portfolio site →
   Site settings → Build & deploy → Build hooks → Add build hook, targeting
   the portfolio's production branch). Until this secret is set, the deploy
   still succeeds and just skips the portfolio ping.
5. The portfolio already defaults `BLOG_MANIFEST_URL` to
   `https://kushalkrishnappa.github.io/blog/posts.json`; only set it in
   Netlify env if overriding.
6. Push to `main` → the Action builds + deploys the blog and pings the hook →
   the portfolio rebuilds and shows the new post.

---

## Security notes

`npm audit` reports some residual moderate-severity advisories. These are all
**build/dev-time transitive dependencies of the latest Docusaurus (3.10.1)** —
they are not present in the deployed static output served from GitHub Pages, and
there is no fix available that does not downgrade Docusaurus (which we do not do).

Cleared safely via `overrides` in `package.json` (build verified green):

- `serialize-javascript` → `^7.0.6` (was the only **high**-severity advisory; RCE / DoS)
- `uuid` → `^11.1.1`

Accepted residual (no non-breaking fix; build/dev-time only):

- `gray-matter` → bundles `js-yaml@3.x` (advisory `<=4.1.1`). `gray-matter@4.0.3`
  requires `js-yaml@^3.13.1`; forcing it to `js-yaml@4.x` is a breaking major bump
  (the `safeLoad`/`safeDump` API was removed in 4.x) and npm leaves the resolution
  invalid, so the advisory does not actually clear. It runs only at build time
  (frontmatter parsing) and is not shipped.
- `webpack-dev-server` / `sockjs` and the `@docusaurus/*` meta-entries: dev-server
  and bundler tooling, pinned by Docusaurus. Dev/build-time only, never in the
  deployed site.

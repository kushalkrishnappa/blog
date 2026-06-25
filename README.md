# Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

## Installation

```bash
yarn
```

## Local Development

```bash
yarn start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
yarn build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Deployment

Using SSH:

```bash
USE_SSH=true yarn deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> yarn deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.

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

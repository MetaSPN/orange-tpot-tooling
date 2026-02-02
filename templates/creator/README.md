# {{displayName}}

Blog archive and metadata for **{{displayName}}**.

- **Blog:** [{{blogName}}]({{blogUrl}})
- **Follow:** [Substack]({{followUrl}})

## Contents

- `posts/` — One markdown file per post (reference/canonical).
- `metadata/` — JSON metadata per post (title, link, published, etc.).
- `creator.json` — Creator and feed info (used by sync and index).

## Sync

A GitHub Action runs daily: it uses [blog-toolkit](https://pypi.org/project/blog-toolkit/) (via `uvx blog-toolkit pull`) to fetch posts, then ingests the JSON into `posts/` and `metadata/`. The workflow installs [uv](https://github.com/astral-sh/uv) so `uvx` is available.

To run sync locally you need [uv](https://github.com/astral-sh/uv) and [Bun](https://bun.sh) (or Node). There are no npm dependencies—`bun install` may report "No packages!" which is expected. Then:

```bash
bun run sync
```

## Template updates

This repo is built from the [orange-tpot](https://github.com/metaspn/orange-tpot-tooling) template. The version is in `.orange-tpot-version`. To pull in template changes (workflows, sync script, etc.) without touching `creator.json`, `posts/`, or `metadata/`:

```bash
bunx github:metaspn/orange-tpot-tooling update
```

A GitHub Action runs **Update from template** weekly and on manual trigger.

## QMD (local search)

After cloning, you can index this repo with [QMD](https://github.com/tobi/qmd) for local full-text and semantic search:

```bash
# Install QMD (once)
bun install -g https://github.com/tobi/qmd

# From this repo root
qmd collection add ./posts --name posts
qmd context add qmd://posts "Blog posts and essays by {{displayName}}"
qmd embed
qmd search "your query"
qmd vsearch "natural language question"
```

Embeddings are stored locally in `~/.cache/qmd/`.

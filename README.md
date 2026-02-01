# orange-tpot

Tooling to create **creator repos** (one per blogger) and an **index repo** that aggregates their metadata.

## Quick start (no clone)

Run the interactive flow without cloning this repo:

- **Bun:** `bunx github:metaspn/orange-tpot-tooling`
- **Node:** `npx github:metaspn/orange-tpot-tooling` (Bun is recommended; the CLI targets Bun)

Running the command with **no arguments** starts the **interactive** flow: pick from a master list, enter a creator manually, or use a local blogger directory.

## Setup (clone for development or local directory)

- **Bun** (recommended): `bun install`
- Or Node 18+ with `npm install` (scripts use `bun run`; adjust to `node` if needed)

## Data

Place your blogger directory at:

- **Default:** `Private & Shared/Orange TPOT Directory/` (gitignored)
- Each file: `{Display Name} {32-char-hex}.md` with lines like `Blog Name:`, `Blog URL:`, `Follow URL:`, `Image URL:`

Override with `--data-dir <path>`.

**Master list (interactive "Pick from list"):** The default list is [data/creators.json](data/creators.json) in this repo (249 creators from the dump). Override with `ORANGE_TPOT_MASTER_LIST_URL` or `--list-url <url>`. To refresh the list from your local blogger directory: `bun run export-creators` (optionally `--data-dir <path>`).

## Commands

### Create creator repo(s)

- **One blogger:**  
  `bun run src/cli.ts create-creator --user "Holly Elmore"`  
  or `--user <hex-id>`

- **All bloggers (with Blog URL):**  
  `bun run src/cli.ts create-creator --all`

- **Options:** `--data-dir <path>`, `--output-dir <path>` (default `./creators`), `--discover-feed`, `--dry-run`, `--list-url <url>` (master list for interactive)

Each creator repo gets:

- `posts/` and `metadata/` (one markdown + one JSON per post)
- `creator.json` (display name, blog URL, follow URL, feed URLs)
- Daily GitHub Action to sync from Substack/blog feed
- QMD instructions for local search

### Create index repo

- `bun run src/cli.ts create-index`  
  Creates `./index-repo` with `creators/manifest.json`, `creators/repos.json`, and a workflow that regenerates the manifest from `subrepos/`.

- **Options:** `--output-dir <path>`, `--dry-run`

### Add creator to index

- `bun run src/cli.ts add-to-index --repo <creator-repo-url> [--slug <slug>] [--index-dir <path>] [--submodule]`

  Appends the repo to `creators/repos.json`. With `--submodule`, runs `git submodule add <url> subrepos/<slug>`. Run this from the **index repo** directory or pass `--index-dir <path>`.

## After scaffolding

### Creator repo

1. `cd creators/<slug>` (e.g. `creators/leo-guinan`).
2. `git init`.
3. **Option A (recommended):** Create the GitHub repo from this folder and push in one step:
   ```bash
   gh repo create <repo-name> --public --source=. --remote=origin --push
   ```
   Example: `gh repo create leo-orange-tpot-test --public --source=. --remote=origin --push`
4. **Option B:** Create the repo on GitHub first, then attach and push:
   - `gh repo create <repo-name> --public` — choose "Create a new repository on GitHub" and **do not** choose "Clone the new repository locally?" (you already have the files).
   - `git remote add origin https://github.com/<owner>/<repo-name>.git`
   - `git add . && git commit -m "Initial: creator repo from orange-tpot" && git branch -M main && git push -u origin main`

Do not choose "Clone the new repository locally?" when using Option B — you already have the scaffolded folder.

Then add the repo to your index (from the index repo):  
`add-to-index --repo <url> --slug <slug> --index-dir . --submodule`

### Index repo

Add creator repos as submodules (or list URLs in `creators/repos.json`). The workflow runs on schedule and updates `creators/manifest.json`.

## Twitter / short-form

Planned later; `creator.json` can already hold a `twitterHandle` (or similar) placeholder.

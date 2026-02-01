# Full archive sync

Sync is powered by [blog-toolkit](https://pypi.org/project/blog-toolkit/), which handles RSS, web crawling, and (where needed) browser-based extraction for full archives (e.g. Substack’s JS-rendered archive).

- **One-off pull (no install):** `uvx blog-toolkit pull https://example.substack.com -o ./posts.json`
- **This repo:** `bun run sync` runs `uvx blog-toolkit pull <blogUrl>` then ingests the JSON into `posts/` and `metadata/`.

For platform limits, feed discovery, and content parsing details, see blog-toolkit’s [Feed Extraction Workarounds](https://github.com/leoguinan/blog-toolkit) (or equivalent doc in the blog-toolkit repo).

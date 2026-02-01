# Blog-toolkit pull → orange-tpot mapping

Reference for aligning blog-toolkit's `pull` output with orange-tpot's expected format. Use this to ensure blog-toolkit outputs the right shape and field names.

## Expected blog-toolkit pull output

**Command:** `uvx blog-toolkit pull <blogUrl> -o ./posts.json --format json`

### Structure

Either:

1. **Top-level array** of post objects:
   ```json
   [
     { "title": "...", "link": "...", ... },
     { "title": "...", "link": "...", ... }
   ]
   ```

2. **Object with `posts` array**:
   ```json
   {
     "posts": [
       { "title": "...", "link": "...", ... },
       ...
     ]
   }
   ```

### Post object fields (orange-tpot expects)

| orange-tpot needs | blog-toolkit field(s) we support | Required | Notes |
|-------------------|----------------------------------|----------|-------|
| **Link (URL)** | `link` or `url` | Yes | Used for deduplication. Must be absolute URL. |
| **Title** | `title` | No | Default: `"Untitled"` |
| **Published date** | `published` or `pub_date` or `published_at` or `date` | No | ISO 8601 or parseable string. Default: `"unknown"` in filename |
| **Content (body)** | `content` or `body` or `description` | No | Default: `"See link for full content."` |
| **ID (guid)** | `guid` or `id` or `link` or `url` | No | Fallback: use link |

Any of these field-name variants will be mapped; we pick the first that exists and is non-empty.

---

## orange-tpot output format

### Output files

For each post we write:

- **`posts/<date>_<slug>.md`** — Markdown body
- **`metadata/<date>_<slug>.json`** — JSON metadata

### Filename

- `date` = `YYYY-MM-DD` from published date, or `"unknown"` if missing/invalid
- `slug` = lowercase, hyphenated, alphanumeric from title (max 80 chars)
- Collision: append `-1`, `-2`, etc. if `date_slug` already exists

### Metadata JSON shape

```json
{
  "title": "string",
  "link": "string (absolute URL)",
  "published": "ISO 8601 string or null",
  "updated": "ISO 8601 string or undefined",
  "source": "substack" | "blog",
  "feedUrl": "string",
  "description": "string or undefined (truncated content ~500 chars)",
  "guid": "string"
}
```

- `source`: `"substack"` if `blogUrl` contains `substack.com`, else `"blog"`
- `feedUrl`: from creator's `feedUrls[0]` or `blogUrl`
- `description`: first 500 chars of content; `undefined` if empty

### Markdown body shape

```markdown
# {title}

- **Published:** {date}
- **Link:** {link}

{content}
```

---

## Deduplication

Posts are deduplicated by **normalized link** (absolute URL, no hash, path trailing slash normalized). We skip any post whose `link`/`url` already exists in `metadata/*.json`.

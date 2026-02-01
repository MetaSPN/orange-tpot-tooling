# QMD setup

From this repo root, add the posts collection to QMD (once per machine):

```bash
qmd collection add ./posts --name posts
qmd context add qmd://posts "Blog posts and essays by this creator"
qmd embed
```

Then search with `qmd search "…"` or `qmd vsearch "…"`.

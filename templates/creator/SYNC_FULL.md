# Full archive sync (Substack and RSS limits)

RSS feeds are limited: **Substack returns only ~20 most recent posts**, Ghost ~15. The default sync uses RSS plus a best-effort static fetch of Substack’s `/archive` page to add more post URLs (stubs). That works without a browser but is incomplete when the archive is heavily JS-rendered.

## For a complete Substack archive

To get every post (titles and URLs), run a **local or self-hosted** job with a headless browser:

1. **Tool:** Use [Playwright](https://playwright.dev/) or similar (e.g. [agent-browser](https://github.com/agent-browser/agent-browser)).
2. **Page:** Open `{blogUrl}/archive` (e.g. `https://yoursubstack.substack.com/archive`).
3. **Lazy loading:** Substack archive uses infinite scroll. Scroll down 15+ times with ~3 second delays between scrolls to load more posts.
4. **Modal:** Dismiss any newsletter signup modal (e.g. click “No thanks”) before extracting.
5. **Extract post links** in the browser context with:

```javascript
(function() {
    const allLinks = Array.from(document.querySelectorAll('a[href*="/p/"]'));
    const seenUrls = new Set();
    const posts = [];
    allLinks.forEach(link => {
        const href = link.href || link.getAttribute('href');
        if (href && href.includes('/p/') && !seenUrls.has(href)) {
            seenUrls.add(href);
            let title = link.textContent.trim();
            if (!title || title.length < 3) {
                const parent = link.closest('article, [class*="post"], [class*="Post"]');
                if (parent) {
                    const titleElem = parent.querySelector('h1, h2, h3, h4, h5, [class*="title"], [class*="Title"]');
                    if (titleElem) title = titleElem.textContent.trim();
                }
            }
            posts.push({ url: href, title: title || 'Untitled' });
        }
    });
    return posts;
})();
```

6. **Merge:** Deduplicate by post URL. Prefer RSS data (full content) when the same URL exists from the default sync. Write stub posts only for URLs not already in `metadata/`.

This repo’s default GitHub Action does **not** run a browser (RSS + static archive only). Use the above for a one-off or scheduled full archive run on your own machine or a self-hosted runner.

## References

- [RSS Feed Data Extraction Workarounds](https://github.com/leoguinan/blog-toolkit) (blog-toolkit doc): platform limits, Substack archive, feed discovery, content/date handling.

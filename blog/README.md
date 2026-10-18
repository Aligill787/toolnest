# ToolNest Blog publishing guide

This website uses a lightweight static blog system. You can add or update articles by editing the file `blog/posts.js`.

## Add a new article

1. Open `blog/posts.js`.
2. Add a new object to the `BLOG_POSTS` array.
3. Use this structure:

```js
{
  slug: 'your-article-slug',
  title: 'Your Article Title',
  excerpt: 'A short summary that appears on the blog list.',
  category: 'Cybersecurity',
  categoryKey: 'cybersecurity',
  date: '2026-10-18',
  updatedDate: '2026-10-18',
  author: 'ToolNest Editorial Team',
  readingTime: 6,
  featured: false,
  seoTitle: 'Your Article Title | ToolNest Blog',
  description: 'A search-friendly article description for SEO.',
  tags: ['keyword', 'related topic'],
  relatedTools: ['word-counter', 'json-formatter'],
  content: `
    <p>Your article body with headings and paragraphs goes here.</p>
    <h2>Section title</h2>
    <p>Useful content for readers.</p>
  `
}
```

## Notes

- `slug` creates the URL: `/blog/your-article-slug/`
- `category` should match one of the supported blog categories
- `relatedTools` should use IDs from existing ToolNest tools only
- `date` controls the article date shown on the blog cards
- `updatedDate` is optional; keep it the same as `date` if not changed
- `content` is HTML, so paragraphs, lists, headings, and links are supported

## Publish changes locally

After editing the blog data, run:

```bash
node scripts/build.mjs
```

This rebuilds the static `dist` output and updates the generated blog pages and sitemap.

## Internal tool linking

Use existing ToolNest pages inside article content. For example:

```js
${blogToolLink('json-formatter', 'Format JSON data')}
```

This creates a link to the real tool route without creating a fake or broken page.

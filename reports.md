# Asset Map

- Logo: `public/brand-logo.png`
- Favicon: `public/favicon.ico`
- Other image: `public/placeholder.svg`
- `src/assets/`: not found

# Current Bug

`index.html` uses `/placeholder.svg` for `og:image` and `twitter:image`, while the actual brand logo asset is `/brand-logo.png`; favicon link is missing.

# Optimized Snippet

```html
<link rel="icon" href="/brand-logo.png" />
<meta property="og:image" content="/brand-logo.png" />
<meta name="twitter:image" content="/brand-logo.png" />
```

# Automatic cache busting for GitHub Pages (ADA)

## What this does
On every push to `main`, the workflow:
1) Rewrites `docs/index.html` to append `?v=<git-sha>` to local `.js` and `.css` references
2) Deploys the `docs/` folder to GitHub Pages

No manual version numbers needed.

## Install
1) Add these files to your repo:
- `.github/workflows/pages-cachebust.yml`
- `scripts/cache-bust.js`

2) In GitHub repo:
- Settings → Pages → **Build and deployment** → Source: **GitHub Actions**

That's it.

## Notes
- Only local assets are modified (no external URLs).
- The deploy uses Node 20.

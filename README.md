# HireALineDancer.com

Static-exportable Next.js MVP for HireALineDancer.com, built from the PRD in `/Users/cjwheelock/Downloads/HireALineDancer_PRD.pdf`.

## What is included

- Homepage with buyer search and founding instructor CTA
- Seeded instructor directory data
- 25 city landing pages
- 6 event-type landing pages
- Instructor profile pages with inquiry forms
- Instructor application, pricing, guarantee, admin prototype, legal pages, and buyer cost guide
- `sitemap.xml`, `robots.txt`, `llms.txt`, schema markup, `CNAME`, and `.nojekyll`
- GitHub Pages branch deployment support with `CNAME` and `.nojekyll`

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The static export is written to `out/`.

## Publish to GitHub

After GitHub CLI authentication is fixed:

```bash
gh auth login -h github.com
gh repo create cjwheelock/hirelinedancers --public --source=. --remote=origin --push
```

Then publish the static export to `gh-pages`:

```bash
npm run build
tmpdir=$(mktemp -d)
cp -R out/. "$tmpdir/"
git -C "$tmpdir" init -b gh-pages
git -C "$tmpdir" add -A
git -C "$tmpdir" commit -m "Deploy static site"
git -C "$tmpdir" remote add origin https://github.com/cjwheelock/hirelinedancers.git
git -C "$tmpdir" push -f origin gh-pages
```

Then in the GitHub repo:

1. Go to **Settings -> Pages**.
2. Set the source to **Deploy from a branch**.
3. Select branch `gh-pages` and folder `/ (root)`.
4. Confirm the custom domain is `hirelinedancers.com`.
5. Enable **Enforce HTTPS** when GitHub allows it.

## Squarespace DNS for `hirelinedancers.com`

In Squarespace, open the domains dashboard, select `hirelinedancers.com`, then open DNS settings and add custom records.

Use these records for the apex/root domain:

| Type | Host | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

Add `www`:

| Type | Host | Value |
| --- | --- | --- |
| CNAME | www | cjwheelock.github.io |

Do not add wildcard DNS records. Remove conflicting default website records if Squarespace reports a conflict.

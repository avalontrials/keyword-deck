# Publish Keyword Deck on GitHub

This folder is ready to publish as a free proof-of-work repository.

## Before uploading

Confirm there is no local state:

- `data/` exists locally but is ignored by `.gitignore`.
- `outputs/` is ignored by `.gitignore`.
- No Apify token or search history is included in the source.
- The sample screenshots under `docs/screenshots` are safe to publish.

## Option A — upload through GitHub

1. Create a new public repository, for example `keyword-deck`.
2. Do **not** initialize it with a README, `.gitignore` or license.
3. Upload the contents of this folder, excluding `data/` and `outputs/`.
4. Commit with:

```text
Keyword Deck: local-first social keyword search desk
```

GitHub will run `.github/workflows/test.yml` on the push.

## Option B — git command line

```bash
git init
git add .
git commit -m "Keyword Deck: local-first social keyword search desk"
git branch -M main
git remote add origin https://github.com/YOUR-USER/keyword-deck.git
git push -u origin main
```

## Suggested repository metadata

**Description**

> A local-first social keyword search desk. Enter keywords, get a ranked deck of public posts worth opening. Built with Node.js and vanilla JS.

**Topics**

`social-media`, `keyword-research`, `local-first`, `nodejs`, `instagram`, `content-discovery`, `vanilla-js`, `proof-of-work`

## Suggested release

Tag `v1.0.0`, attach the `KeywordDeck-v1.0.zip`, and use:

```text
Keyword Deck v1.0 — blank local social search desk
```

Include the screenshot from `docs/screenshots/keyword-deck.png` in the release notes.

## What to say in the README / post

Keyword Deck is a small proof of work: a local-only social search desk that:

- takes any user keywords;
- searches a public index;
- resolves public Instagram links;
- enriches public captions and previews;
- ranks posts by relevance and freshness;
- provides manual lanes for communities that do not offer open search;
- never logs in, comments, messages or posts automatically.

The source is the proof: plain Node.js, no framework, 14 tests, a local HTTP server, and a clean UI.

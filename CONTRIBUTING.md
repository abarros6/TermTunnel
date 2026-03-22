# Contributing to TermTunnel

## What changed

We consolidated from two repos (Curtisflo private + abarros6 public) to a **single repo**: `github.com/abarros6/TermTunnel`. The old private repo is archived. All dev work now happens here on feature branches.

## Setup

```bash
git clone https://github.com/abarros6/TermTunnel.git
cd TermTunnel
npm install
cp .env.example .env   # edit with your AUTH_TOKEN and PORT
npm run dev             # or: node server.js
```

## Workflow

1. **Branch from main:** `git checkout -b feature/my-thing`
2. **Push:** `git push -u origin feature/my-thing`
3. **Open a PR** against `main`
4. **Squash merge** — GitHub is configured to squash-merge only, so `main` stays clean
5. Branch auto-deletes after merge

**No direct pushes to `main`** — branch protection is on.

## Conventions

- **ESM only** — `import`/`export`, no `require`
- **No build step** — `public/index.html` is the entire frontend
- **Commits:** imperative mood, < 72 char subject line (`feat: ...`, `fix: ...`, `docs: ...`)

## Claude Code

Both devs use Claude Code. `CLAUDE.md` at the repo root is the shared context file — **keep it accurate** when you make changes. Your personal `.claude/settings.local.json` is gitignored.

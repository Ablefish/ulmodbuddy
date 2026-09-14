---
name: release
description: Cuts a new UL Mod Buddy release -- scans README/GUIDE for accuracy, updates CHANGELOG.md, bumps the version badge, commits, tags, pushes, and publishes a GitHub Release with the changelog entry as its notes. Use when the user asks to release, ship, cut a version, or publish an update to UL Mod Buddy.
---

# UL Mod Buddy release process

This repo deploys to GitHub Pages **only on `v*` tag pushes** (see
`.github/workflows/pages.yml` and the project memory
`ulmodbuddy_pages_deploy_workflow.md`) -- plain pushes to `master` never go
live. That means steps 1-5 below are safe to do freely; **step 6 onward is
what actually ships to the public site and creates a public Release page,
so confirm with the user before pushing the tag or creating the Release.**

Optional argument: the user may pass a version number or bump size (e.g.
`/release 1.1.0`, `/release minor`). If omitted, infer the bump from the
diff yourself (see step 2) and propose it -- every release so far has been
a patch bump (bug fixes / docs / cleanup), so default to patch unless the
pending changes clearly add a new user-facing feature.

## 1. See what's actually pending

```
git status
git diff --stat
git log --oneline -5
git tag -l --sort=-v:refname
```

Read the full diff (not just the stat) for anything touching behavior --
`app/*.js`, `app/*.py`/`build/build.py`, `app/index.html`, `app/styles.css`
-- so steps 2 and 3 below are grounded in what actually changed, not
guesswork. If there's nothing staged or unstaged and no new commits since
the last tag, say so and stop -- there's nothing to release.

## 2. Scan README.md and GUIDE.md for accuracy

This is not a proofread -- it's a **behavioral accuracy check**: does what
these docs describe still match what the app actually does right now?
Compare their claims against the current source, in particular:

- **README.md**: the zero-install setup steps against `app/index.html` +
  `app/setup.js` (button labels, flow order); the Python fallback steps
  against `app/server.py` + `app/setup.js`'s form handling; the "No mod
  content is bundled" section against whether icons are actually copied
  anywhere in either flow (`build.js` vs `build/build.py`); browser
  support claims against any new API usage.
- **GUIDE.md**: every screenshot's caption and surrounding text against
  the actual current UI in `app/index.html`/`app/app.js`/`app/styles.css`
  (button names, panel names, section titles); the "Keeping the data
  current" section against both rebuild flows (picker modal vs. the
  Python-fallback form); anything describing a feature that's since
  changed shape.

If you find a genuine inaccuracy (a renamed button, a changed flow, a
feature that no longer works the way it's described), fix it directly --
these docs should never describe stale behavior. If you find wording that
is *technically* still accurate but you think reads awkwardly or could be
clearer, don't rewrite it unprompted -- this user is particular about the
exact phrasing in these two files (see project memory / prior sessions);
flag it and ask instead of guessing at their preferred wording.

Report what you checked and what (if anything) you changed before moving
on -- don't silently fold doc fixes into the release commit without
mentioning them.

## 3. Decide the version and draft the changelog entry

Look at `CHANGELOG.md`'s most recent entry for the format to match
(Keep a Changelog style: `### Added` / `### Changed` / `### Fixed`
subsections, bold lead-in per bullet, brief plain-language explanation of
user-facing impact). Draft a new `## [X.Y.Z] - YYYY-MM-DD` entry (today's
date) at the top, summarizing the diff from step 1 and any doc fixes from
step 2. Keep it in the same voice as existing entries -- concise, no
internal narrative about how the change was made, just what changed and
why it matters to someone using the app.

Insert it into `CHANGELOG.md` above the previous top entry.

## 4. Bump the version badge

`app/index.html` has a static version badge:

```html
<span id="app-version" class="app-version" title="...">vX.Y.Z</span>
```

Update it to match the new version. This is deliberately static markup
(not derived from the dataset) so it's visible immediately on any page
load regardless of cache state -- don't make it dynamic.

## 5. Review, then commit

Run `git diff` once more over everything staged so far (changelog, version
badge, any doc fixes, plus whatever was already pending from step 1) and
confirm it's exactly the intended scope -- no stray files, no
accidentally-included build artifacts (`app/data.js`, `app/icons/` should
never be committed -- check `.gitignore` covers them if unsure).

Commit with a message describing what shipped, in the same style as prior
release commits (`git log` for examples) -- a one-line summary starting
with `vX.Y.Z:`, then a body explaining the notable changes and why, ending
with whatever attribution trailer this session's own instructions specify
(check the current system reminder for the exact `Co-Authored-By` line
rather than hardcoding one here, since it can change between models).

## 6. Confirm before shipping

**Stop and show the user**: the version number, the draft changelog entry,
and a one-line note on any doc fixes from step 2. Ask whether to proceed --
pushing the tag deploys the live site and the GitHub Release is public.
Do not push or tag without an explicit go-ahead.

## 7. Push, tag, and release

Once confirmed:

```
git push origin master
git tag -a vX.Y.Z -m "vX.Y.Z: <one-line summary>"
git push origin vX.Y.Z
```

The tag push triggers the Pages deploy workflow -- mention this to the
user so they know the live site is about to update.

Then create the GitHub Release, using the new CHANGELOG entry's body
(everything under the `## [X.Y.Z]` heading, minus the heading itself) as
the release notes verbatim -- **the release notes must not be empty or a
placeholder**, since that's the whole point of this step. Write the notes
to a scratch file first and pass it via `--notes-file` rather than
inlining through a shell heredoc (heredocs here have been finicky through
PowerShell).

`gh` may not be on PATH in this environment even when installed -- if
`gh release create ...` fails with a "not recognized" / "command not
found" error, locate it first:

```powershell
Get-Command gh -ErrorAction SilentlyContinue
where.exe gh
Test-Path "C:\Program Files\GitHub CLI\gh.exe"
```

and invoke it by full path if needed:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" release create vX.Y.Z --title "vX.Y.Z" --notes-file "<path to notes file>"
```

Report back the release URL `gh` prints on success.

## Troubleshooting: tag rejected by environment protection rules

If the tag push succeeds but the Pages deploy run fails with something
like `Tag 'vX.Y.Z' is not allowed to deploy to github-pages due to
environment protection rules`, the repo's auto-created `github-pages`
environment has lost its tag-deployment policy (see the project memory
file for the full story). Re-add it and rerun:

```
gh api --method POST repos/Ablefish/ulmodbuddy/environments/github-pages/deployment-branch-policies -f name='v*' -f type=tag
gh run rerun <run-id>
```

This should already be configured from prior releases -- only needed if
it's somehow been reset.

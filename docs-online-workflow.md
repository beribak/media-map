# Cloud-only GitHub workflow (no terminal)

If you are using an online workspace and do **not** have a local terminal, use this exact GitHub web flow.

## A) See/create a branch in the GitHub UI
1. Open your repository on GitHub: `https://github.com/<you>/<repo>`.
2. Click the branch dropdown above the file list (it usually shows `main`).
3. Type a new branch name (example: `work`).
4. Click **Create branch: work from 'main'**.

## B) Apply code changes directly in the browser
1. Open the file you want to change (example: `scripts/fetch-time-mk.mjs`).
2. Click the pencil icon (**Edit this file**).
3. Paste your changes.
4. Scroll down to **Commit changes**.
5. Select **Commit directly to the work branch**.
6. Click **Commit changes**.

## C) Open a pull request (PR)
1. After commit, click **Compare & pull request** (banner),
   or go to **Pull requests** → **New pull request**.
2. Set:
   - **base**: `main`
   - **compare**: `work`
3. Add title + description.
4. Click **Create pull request**.

## D) Merge the PR
1. Open the PR page.
2. Wait for checks to finish (green check marks).
3. Click **Merge pull request** (or **Squash and merge** if your repo uses squash).
4. Click **Confirm merge**.
5. Optionally click **Delete branch**.

## E) If your scraper is in GitHub Actions
1. Go to **Actions** tab.
2. Click your workflow (example: "Fetch Articles").
3. Click **Run workflow** (top-right) and choose branch `main`.
4. Open the latest run and inspect failed step logs.

---

## Why the agent said "can’t push"
The agent can only push if this cloud runtime has both:
- a configured git remote (`origin`), and
- write credentials/token.

If either is missing, commits can exist in the workspace but not appear on GitHub until you use the browser flow above.


## F) How to get **the agent's existing changes** into GitHub
If the agent already changed files in the cloud workspace, you have 3 practical ways to move those changes to GitHub.

### Option 1 (best): Ask the agent to push directly
This only works if the runtime has both a Git remote and write auth.

Ask the agent to run these exact commands:
1. `git status --short --branch` (shows current branch + changed files)
2. `git remote -v` (shows whether `origin` exists)
3. `git push -u origin <branch-name>`

If `git push` succeeds, your changes are now on GitHub immediately under that branch.

### Option 2: Copy the exact file diffs from this chat into GitHub UI
Use this when agent push is not possible.

1. In this chat, ask: **"show me full contents of `<file>`"** for each changed file.
2. In GitHub repo UI, open that same file and click **Edit this file**.
3. Replace file content with what the agent showed.
4. Commit to a new branch in UI.
5. Open PR and merge.

### Option 3: Download/apply a patch (terminal required somewhere)
If you have *any* terminal (Codespaces/VM/local):
1. Save patch text to `changes.patch`.
2. Run `git apply changes.patch`.
3. `git add -A && git commit -m "apply cloud changes"`
4. `git push -u origin <branch>`

---

## Quick answer to your exact question
- **Where are the changes?** In the cloud workspace git repo on branch `work` (inside `/workspace/media-map`).
- **Can you push a file directly?** Not as a single "upload from agent" button. It must be committed and pushed via git, or manually pasted in GitHub UI.
- **How do they get to GitHub?** Only by `git push` with a configured remote + write credentials, or by manual browser edits and commits.

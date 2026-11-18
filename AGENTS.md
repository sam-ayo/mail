# Git workflow: push directly to main

This project uses one branch only. Agents must commit and push all changes directly to `main`.

Rules:

- Do not make a feature branch.
- Do not open a pull request.
- Before you start work, run `git checkout main` and `git pull --rebase origin main`.
- After you commit, run `git push origin main`.
- If the push fails because `origin/main` changed, run `git pull --rebase origin main`. Then push again.
- Do not use `git push --force` on `main`.

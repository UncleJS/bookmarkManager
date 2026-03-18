---
description: Fix a GitHub issue — branch, implement, commit, and open a PR
---

Fix GitHub issue #$ARGUMENTS in this repository.

Follow these steps in order:

1. **Read the issue**
   Run: `gh issue view $ARGUMENTS`
   Understand the problem, expected behaviour, and any additional context in the comments.

2. **Create a branch**
   Determine the default branch with: `git remote show origin | grep 'HEAD branch'`
   Then create and switch to a new branch:
   `git checkout -b fix/issue-$ARGUMENTS`

3. **Implement the fix**
   - Follow the existing code style and patterns in the project.
   - Keep changes focused — only touch what is needed to fix the issue.
   - Do not introduce unrelated changes or refactors.

4. **Commit the changes**
   Stage all changed files and commit with a message that references the issue:
   `git add -A && git commit -m "fix: resolve issue #$ARGUMENTS"`

5. **Open a pull request**
   Run: `gh pr create --title "fix: resolve issue #$ARGUMENTS" --body "Closes #$ARGUMENTS"`
   The PR body must include `Closes #$ARGUMENTS` so GitHub auto-closes the issue on merge.

After the PR is created, output the PR URL so it is easy to find.

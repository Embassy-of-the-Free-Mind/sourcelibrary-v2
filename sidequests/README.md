# sidequests/

A parking place for side projects that grow out of Source Library work but are
not part of it. Each subfolder is its **own git repository** with its own remote,
issues and deploys. Nothing in here is tracked by sourcelibrary except this README.

Why it exists: side projects were accumulating as loose folders at the repo root
(and as loose repos in home directories), each needing its own entry in
`.gitignore`, `.vercelignore` and `tsconfig.json`. One parent folder is guarded once.

## Rules

- **One folder per sidequest, each a separate repo.** `git clone` or `git init`
  inside it. Commit and push from inside that folder, never from the sourcelibrary root.
- **This repository is public; a sidequest may not be.** Nothing under `sidequests/`
  can be committed here (`.gitignore`), uploaded by `vercel --prod`, which ignores
  `.gitignore` (`.vercelignore`), or type-checked (`tsconfig.json` exclude).
  If you add a new guard of that kind elsewhere, add `sidequests` to it.
- **It exists only in the main checkout.** Worktrees do not see it. That is intended.
- **It is per-machine.** A collaborator's `sidequests/` holds their own projects, or nothing.
- A sidequest that becomes part of the product moves out of here through a normal PR.

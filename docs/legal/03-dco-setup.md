# Developer Certificate of Origin (DCO)

## What This Is

The DCO is a lightweight alternative to a Contributor License Agreement
(CLA). Contributors certify that they have the right to submit their
contribution under the project's license by adding a `Signed-off-by`
line to their commits.

This is the same mechanism used by the Linux kernel, Git, and many other
AGPL/GPL projects.

## The DCO Text

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## How to Sign Off

Add `-s` to your git commit command:

```bash
git commit -s -m "Your commit message"
```

This adds a line like:

```
Signed-off-by: Jane Doe <jane@example.com>
```

## Enforcement Setup

To enforce DCO sign-off on pull requests, install the
[DCO GitHub App](https://github.com/apps/dco) on the repository.
It checks that all commits in a PR have a valid `Signed-off-by` line.

### Steps:
1. Go to https://github.com/apps/dco
2. Click "Install"
3. Select the `Embassy-of-the-Free-Mind/sourcelibrary-v2` repository
4. Done — the app will automatically check all new PRs

## AI-Generated Code

Commits authored or co-authored by AI tools (Claude, GitHub Copilot,
etc.) should be signed off by the human who directed the work. The human
is certifying that they have the right to submit the contribution, which
includes taking responsibility for AI-assisted output.

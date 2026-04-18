# AGENTS.md

## Purpose
Use the current checked-out docs tree as the implementation authority for this repo.

## Start here
- Read `docs/00-index.md` first.
- For inbox work, read `docs/02-bundles/inbox-bundle.md`.
- Then read the required core docs listed there.

## Authority
- The current checked-out `docs/` tree is authoritative.
- Do not use `docs/restart-agent-focus` unless that path actually exists in this checkout.
- Do not treat duplicate worktree copies, local Finder copies, or older restart artifacts as canon.

## Working rules
- Preserve locked inbox semantics from the inbox bundle.
- Fix correctness and trust before styling.
- Do not widen scope silently.
- If implementation suggests a product decision change, stop and surface it explicitly.

## Inbox recovery priority
1. queue truth
2. message truth
3. activity truth
4. discoverability

## Current execution note
For the current inbox trust recovery effort on `main-working`, implement Stage 1 first before starting later stages.

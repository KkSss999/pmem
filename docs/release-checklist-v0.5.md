# pmem v0.5 Release Checklist

Use this checklist before tagging or publishing v0.5.0.

## Scope Check

- [ ] v0.5 remains Productization Beta only.
- [ ] No embedding implementation was added.
- [ ] No `pmem serve`, MCP, REST, Graph UI, telemetry, or remote service work was added.
- [ ] README, package readiness, E2E, agent docs, and release artifacts are complete.

## Version Check

- [ ] `package.json` version is `0.5.0`.
- [ ] `package-lock.json` root version is `0.5.0`.
- [ ] `src/index.ts` Commander version is `0.5.0`.
- [ ] `CHANGELOG.md` has a `0.5.0` section.

## Documentation Check

- [ ] `README.md` explains why pmem exists.
- [ ] `README.md` has install instructions.
- [ ] `README.md` has a 5-minute quick start.
- [ ] `README.md` documents exit code semantics.
- [ ] `README.md` documents troubleshooting for missing `.pmem`, missing DB, no ask matches, non-git projects, FTS5 fallback, and dirty flags.
- [ ] `AGENTS.md` and `CLAUDE.md` match v0.5 scope.
- [ ] `pmem init` generated integration templates match v0.5 workflow.

## Test Check

Run:

```bash
npm test
npm run build
npm run test:e2e:install
npm run test:e2e:workflow
```

Expected:

- [ ] Unit tests pass.
- [ ] TypeScript build passes.
- [ ] Install smoke E2E passes.
- [ ] Real workflow E2E passes.

## Package Check

Run:

```bash
npm pack --dry-run
```

Expected:

- [ ] Package name is `pmem`.
- [ ] Package version is `0.5.0`.
- [ ] Tarball includes `dist/`.
- [ ] Tarball includes `README.md`.
- [ ] Tarball includes `LICENSE`.
- [ ] Tarball includes top-level `docs/*.md`.
- [ ] Tarball excludes `src/`.
- [ ] Tarball excludes `temp/`.
- [ ] Tarball excludes `.pmem/`.
- [ ] Tarball excludes `node_modules/`.
- [ ] Tarball excludes compiled test files.

## Install Smoke

Run:

```bash
npm run build
TARBALL="$(npm pack --silent)"
TMP_PREFIX="$(mktemp -d)"
npm install -g --prefix "$TMP_PREFIX" "./$TARBALL"
"$TMP_PREFIX/bin/pmem" --version
"$TMP_PREFIX/bin/pmem" --help
rm -f "$TARBALL"
rm -rf "$TMP_PREFIX"
```

Expected:

- [ ] `pmem --version` prints `0.5.0`.
- [ ] `pmem --help` lists the v0.5 public commands.

## Publish Decision

- [ ] Confirm whether v0.5.0 is Internal Beta only or Public Beta.
- [ ] Confirm npm account and publish permission.
- [ ] Confirm the `pmem` package name is available or accessible.
- [ ] Confirm repository visibility and issue tracker policy.

## Final Commands

Only if publishing:

```bash
npm publish --dry-run
npm publish
```

After publishing:

- [ ] Create git tag `v0.5.0`.
- [ ] Push branch and tag.
- [ ] Create GitHub release notes from `CHANGELOG.md`.


# pmem v0.6 Release Checklist

Use this checklist before tagging or publishing v0.6.0.

## Scope Check

- [ ] v0.6 remains Agent-native Workflow Polish only.
- [ ] No embedding, MCP/REST, Graph UI, telemetry, or remote service was added.
- [ ] Non-interactive init, error UX, empty result guidance, and Claude Code slash commands are complete.

## Version Check

- [ ] `package.json` version is `0.6.0`.
- [ ] `package-lock.json` root version is `0.6.0`.
- [ ] `src/index.ts` Commander version is `0.6.0`.
- [ ] `CHANGELOG.md` has a `0.6.0` section.

## Test Check

Run:

```bash
npm test
npm run build
npm run test:e2e:install
npm run test:e2e:workflow
npm run test:e2e:non-git
npm run test:e2e:v06-init
npm run test:e2e:v06-answers
npm run test:e2e:v06-claude
npm run test:e2e:v06-empty
npm run test:e2e:v06-nongit
```

Expected:

- [ ] Unit tests pass (90+).
- [ ] TypeScript build passes.
- [ ] All E2E scripts pass.

## Package Check

Run:

```bash
npm pack --dry-run
```

Expected:

- [ ] Package name is `pmem-ai`.
- [ ] Package version is `0.6.0`.
- [ ] Tarball includes `dist/`.
- [ ] Tarball includes `README.md`, `LICENSE`, `CHANGELOG.md`.
- [ ] Tarball includes `docs/*.md` including `docs/usage.md`.
- [ ] Tarball excludes `src/`, `temp/`, `.pmem/`, `node_modules/`.
- [ ] Tarball excludes compiled test files.

## Publish Decision

- [ ] Confirm whether v0.6.0 is ready to publish.
- [ ] Confirm npm account and publish permission.
- [ ] Confirm CI/CD publish job will run on push to main.

## Final Commands

```bash
npm publish --access public
# or push to main for CI/CD auto-publish
```

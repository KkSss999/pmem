# pmem v0.7.0 Release Checklist

Use this checklist before tagging or publishing v0.7.0.

## Scope Check

- [ ] Universal Agent Memory (presets, custom card types, and domain neutrality) is complete.
- [ ] No embedding, MCP/REST, Graph UI, telemetry, or remote service was added.
- [ ] Presets (software, novel, research) loading, custom directories creation, schema validation, domain-neutral recall / status output, generic ignores and skills, and early exit for discover disabled are complete and verified.

## Version Check

- [ ] `package.json` version is `0.7.0`.
- [ ] `CHANGELOG.md` has a `0.7.0` section.
- [ ] `docs/project-roadmap.md` has updated `v0.7.0` to completed status.

## Test Check

Run:

```bash
npm test
npm run test:e2e:install
npm run test:e2e:workflow
npm run test:e2e:v061-suggest
npm run test:e2e:v063-discover
npm run test:e2e:v07-novel
npm run test:e2e:v07-research
```

Expected:

- [ ] Unit tests pass (160+).
- [ ] TypeScript build passes.
- [ ] All E2E scripts pass.

## Package Check

Run:

```bash
npm pack --dry-run
```

Expected:

- [ ] Package name is `pmem-ai`.
- [ ] Package version is `0.7.0`.
- [ ] Tarball includes `dist/`.
- [ ] Tarball includes `skills/pmem/SKILL.md` and `skills/pmem/references/`.
- [ ] Tarball includes `README.md`, `LICENSE`, `CHANGELOG.md`.
- [ ] Tarball includes `docs/*.md` including `docs/usage.md`.
- [ ] Tarball excludes `src/`, `temp/`, `.pmem/`, `node_modules/`.
- [ ] Tarball excludes compiled test files.

## Publish Decision

- [ ] Confirm npm account and publish permission.
- [ ] Confirm CI/CD publish job will run on push to main or tag push.
- [ ] Decide whether to backpublish `v0.6.4` or directly release `v0.7.0`.

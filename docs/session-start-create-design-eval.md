# v0.6.4 polish 4 — `pmem session start --create-if-missing` Design Evaluation

> **Scope:** Design evaluation only. **No code changes** are proposed in this document.
> Author: Sub-agent 1 (polish 4) | Date: 2026-06-02
> Source: `docs/v0.6.4 pre-design.md` §6.1 (task 4)
> Coordination note: This file is **independent** of `docs/handover-v0.6.4.md` to avoid concurrent-write conflicts with the sub-agent writing that handover file.

---

## 1. Question

Should `pmem session start` accept a `--create-if-missing` option that auto-creates a
minimal `.pmem/` skeleton when the user runs the command in a directory that has no
`.pmem/` yet?

Pre-design framing (`docs/v0.6.4 pre-design.md` §6.1):

> 加 `--create-if-missing` option 的风险面：自动创建可能掩盖"用户在错目录跑 pmem"的问题

---

## 2. Current behavior (baseline)

`src/commands/session.ts:7-14` (verified in this polish):

```typescript
export function sessionStartCommand(agentName?: string): void {
  const pmemPath = path.join(process.cwd(), PMEM_DIR);
  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }
  ...
}
```

Reproduced E2E in `temp/polish-4-6-7-test/session-pmem/`:

```bash
$ cd temp/polish-4-6-7-test/session-pmem   # no .pmem/
$ pmem session start -a "TestAgent"
No .pmem directory found. Run `pmem init` first.
```

Behavior is currently: **silent early-return with a one-line hint**, exit code 0.
There is no `pmem.db` check, no `manifest.yml` check, no error — the user gets a
calm "go init first" message.

---

## 3. Risk surface

If we add `--create-if-missing`, the following scenarios change behavior:

### 3.1 Wrong-directory masking (highest risk)

A user `cd`s into the wrong project root, runs `pmem session start --create-if-missing`,
and ends up with a brand-new `.pmem/` in a directory that was never their project.
They then run `pmem ask ...` and get fresh-empty results, which they misinterpret
as "the project really has no memory yet" — when actually they just polluted
`/tmp/whatever/` with a fresh memory store.

Probability: medium. Cost: medium (user confusion, possible unintended writes to
a directory they didn't intend to track).

### 3.2 Empty-memory false confidence (medium risk)

A freshly auto-created `.pmem/` has zero cards. The user runs `pmem status` and
sees "ok" everywhere (since the schema is created, manifest is valid, no dirty
flags, no cards), interprets the green dashboard as "nothing to do" and walks
away from the real project that they meant to be in.

Probability: low. Cost: medium.

### 3.3 Lost init guidance (low risk)

The current `pmem init` flow has hooks for `--guided`, `--answers`, integration
installation, and stack detection. If `session start` short-circuits init, the
user never sees any of that. They get a session ID but no memory cards, no
`index.md`, no `AGENTS.md`, no integration template.

Probability: high. Cost: low (recoverable — they can run `pmem init` later, but
their session ID is now associated with an empty store).

### 3.4 Conflict with v0.6 track's "confirmation-first" principle

The pre-design §三 (P2 §v0.6 设计原则) is explicit:

> 5. Agent workflow is confirmation-first: detect, suggest, confirm/apply, rebuild, verify.

Auto-creating a `.pmem/` on session start is the opposite of confirmation-first —
it commits the user to a memory store before they confirmed the project shape.
This isn't catastrophic, but it's a tone mismatch with the rest of the v0.6 design.

### 3.5 Interplay with v0.6.2 exit code changes

After v0.6.2, agents parse `--format json` to determine next steps. A new
`--create-if-missing` flag would have to be reflected in JSON output (`session
start` currently doesn't have JSON output, only text). Adding a flag without
planning its machine-readable representation risks re-introducing the friction
that v0.6.2 just removed.

---

## 4. Survey of comparable agent tools

(For the record; the live web search was not reachable from this environment,
so this is based on knowledge of how these tools behave at v0.6 design time.)

| Tool | Auto-creates root config dir? | Auto-creates project memory? | Behavior on missing |
|------|-------------------------------|------------------------------|---------------------|
| Claude Code | Yes — `.claude/` per repo | **No** — `CLAUDE.md` is user-initiated | Suggests `claude init` / first-run dialog |
| Cursor | Yes — `.cursor/` per workspace | **No** — `.cursor/rules/*.mdc` are user-initiated | Shows "no rules" indicator; does not auto-create |
| Codex CLI | Yes — `.codex/` per project | **No** — `AGENTS.md` is user-initiated | Suggests `codex init` / writes a stub on first prompt only if user explicitly opts in |

**Pattern across all three:** root config dirs are auto-created silently (cheap
infrastructure), but **project-memory artifacts are user-initiated**. None of
these tools auto-magically creates a project memory on first session start.

pmem's situation is closer to "project memory" than "root config" — the
`.pmem/` is the actual source of truth for the project, not just a settings
folder. So the analogy is: `pmem session start --create-if-missing` would be
asking the tool to do something none of Claude Code, Cursor, or Codex does.

---

## 5. Recommendation

**Defer (do not implement in v0.6.4). Re-evaluate in v0.7.0+ as part of the
"agent-native cold-start" track.**

Reasons:

1. **Risk profile outweighs benefit.** The main beneficiary of `--create-if-missing`
   is the "user forgot to init" case, which is recoverable in ~5 seconds
   (`pmem init` then `pmem session start` again). The cost of accidentally
   creating a memory store in the wrong directory is much higher.

2. **No comparable tool does this.** The three agent CLIs pmem cares most about
   (Claude Code, Cursor, Codex) all require explicit initialization for
   project-memory artifacts. Adopting auto-create would be a divergence from
   the ecosystem without a clear user-experience win.

3. **Tone mismatch with v0.6 track.** v0.6 is confirmation-first; auto-create
   on session start is the opposite.

4. **Better solution already exists.** `pmem doctor` already detects "no
   `.pmem/`" with a clear `fix: Run: pmem init <project-name>` message. The
   current `pmem session start` message is also clear. The friction is
   real but it's 5 seconds, not blocking.

5. **v0.7.0 is the right home.** v0.7.0's "Universal Agent Memory" track will
   redesign cold-start, including potentially auto-bootstrap from project
   markers (e.g., detect a `package.json` and offer to init). At that point
   we can do `--create-if-missing` properly with confirmation prompts,
   wizard, and stack detection — none of which fit in a v0.6.4 polish slot.

### What I would change in v0.6.4 (zero-risk improvement, no auto-create)

While evaluating this, I noticed `pmem session start` on a missing `.pmem/`
prints a single line: `No .pmem directory found. Run `pmem init` first.`

A **zero-risk** improvement that aligns with the polish 6/7 tone improvements
would be to expand that one-liner into a 3-line hint that mentions the
agent-native flags and a sample `pmem init` invocation. That is **not**
`--create-if-missing`; it's just richer help text. I will leave this as a
candidate for v0.6.5 if anyone wants to bundle it with the other session-text
polish, but I am not implementing it in this polish (polish 4 is design-only
per pre-design §6.1).

### What I would change in v0.7.0 (if/when we revisit)

- Add `--create-if-missing` with an **explicit confirmation prompt** unless
  `--yes` is passed.
- When auto-creating, run the same skeleton that `pmem init --minimal` would
  produce (no guided wizard, no integration install — just the bare structure).
- Print a banner: `Auto-created .pmem/ in /this/dir. Use `pmem init --guided`
  to enrich with project context, or remove .pmem/ if this was a mistake.`
- Add a guard: refuse to create `.pmem/` if the current directory is
  `$HOME`, `/`, `/tmp`, or any parent of those — to prevent catastrophic
  auto-creation at the filesystem root.

---

## 6. Summary (1 sentence)

**Defer `--create-if-missing` to v0.7.0+; the friction it removes is 5 seconds
of `pmem init`, but the wrong-directory masking risk is non-trivial and no
comparable agent tool (Claude Code / Cursor / Codex) auto-creates project
memory on first session.**

---

## 7. Coordination note

This document is intentionally written to `docs/session-start-create-design-eval.md`
(separate file) instead of `docs/handover-v0.6.4.md` to avoid concurrent-write
conflicts with the sub-agent writing that handover. The main agent should
either:
- Link this file from the handover under a "polish 4 evaluation" section, or
- Inline §5 and §6 of this file into the handover's session-start section.

Either way, the source of truth for the design evaluation lives here.

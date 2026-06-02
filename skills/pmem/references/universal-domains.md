# Universal Domains and Custom Schemas

pmem v0.7.0 is domain-neutral. It still works for software codebases, but it can also initialize memory for writing, research, and custom agent projects.

## Domain Presets

```bash
pmem init my-service --domain software
pmem init my-novel --domain novel
pmem init my-study --domain research
```

| Preset | Card directories | Foundational types | Discover |
|--------|------------------|--------------------|----------|
| `software` | `modules`, `features`, `decisions`, `tasks`, `risks`, `traces` | `module` | enabled |
| `novel` | `characters`, `chapters`, `world`, `arc`, `decisions`, `traces` | `character`, `chapter` | disabled |
| `research` | `sources`, `claims`, `notes`, `experiments`, `decisions`, `traces` | `source`, `claim` | disabled |

## Manifest Schema

The manifest controls valid card types and runtime behavior:

```yaml
schema:
  card_types: [source, claim, note, experiment, decision, trace]
  type_dirs:
    source: sources
    claim: claims
    note: notes
    experiment: experiments
    decision: decisions
    trace: traces
  foundational_types: [source, claim]
  evidence_types: [decision, trace]
  creatable_types: [source, claim, note, experiment, decision, trace]
  default_type: note
discover:
  enabled: false
```

Use `schema.creatable_types` to decide what `pmem new <type> <title>` may create. Use `schema.foundational_types` to decide what appears in recall as the project's core context.

## Recall JSON

For machine-readable recall:

```bash
pmem recall --format json
```

Read `active_foundation` for foundational cards. `active_modules` is kept as a compatibility alias and contains the same list.

## Discovery

`pmem discover` is useful for software projects because it scans imports and package dependencies. It is disabled by default for `novel` and `research` presets:

```bash
pmem discover --format json
# exits 0 with a disabled message when discover.enabled is false
```

Enable it only when the project has source files that benefit from relationship discovery.

## Legacy Compatibility

v0.6.x projects do not need migration. If `.pmem/manifest.yml` has no `schema` block, pmem falls back to the legacy software defaults and does not rewrite the manifest.

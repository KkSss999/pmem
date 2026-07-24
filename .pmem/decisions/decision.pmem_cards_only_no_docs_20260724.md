---
id: decision.pmem_cards_only_no_docs_20260724
type: decision
title: "Documentation policy: pmem cards only, no docs directory"
status: active
tags: [governance, source-of-truth, pmem, documentation]
created: "2026-07-24"
updated: "2026-07-24"
related_to:
  - decision.pmem_two_layer_architecture_20260722
  - decision.post_v1_1_macos_required_platform_20260724
  - decision.v1_1_1_macos_semantic_retrieval_20260724
---
# Documentation Policy: pmem Cards Only

## Decision

The repository must not contain a standalone documentation directory. Durable product plans,
architecture decisions, release context, handoffs, and acceptance evidence are
recorded as Markdown cards under `.pmem/`.

## Consequences

- `.pmem/**/*.md` remains the human-readable, Git-managed source of truth.
- `.pmem/pmem.db` remains a rebuildable runtime index and never replaces cards.
- New work records important context in the appropriate `.pmem` card type rather
  than creating standalone documents.
- Existing card references to removed standalone documents are invalid and must
  not be reintroduced.

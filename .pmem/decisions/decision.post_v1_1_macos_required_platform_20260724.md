---
id: decision.post_v1_1_macos_required_platform_20260724
type: decision
title: "Post-v1.1.0 platform policy: macOS is the only required target"
status: active
tags: [platform-policy, macos, v1.1, compatibility, release]
created: "2026-07-24"
updated: "2026-07-24"
depends_on:
  - decision.v1_1_system_memory_release_20260722
related_to:
  - decision.v1_1_1_macos_semantic_retrieval_20260724
  - feature.v1_1_1_lightweight_semantic_layer_20260626
classification: decision
trust_label: user_confirmed
sensitivity: internal
---
# Post-v1.1.0 Platform Policy

## Decision

Beginning after v1.1.0, **macOS is the only mandatory supported and acceptance-tested platform for every pmem release**.

Linux, Windows, and other operating systems may be considered later when there is clear demand and a dedicated compatibility plan. They are not release blockers, receive no compatibility promise, and must not expand the scope of a post-v1.1.0 milestone by default.

## Consequence

Every future feature plan must state its macOS installation, runtime, and acceptance evidence. A feature may add cross-platform support only through an explicit new decision; it cannot be inferred from Node.js or TypeScript portability alone.

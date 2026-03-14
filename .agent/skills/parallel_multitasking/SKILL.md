---
name: Parallel Multi-Tasking Workflow
description: A specialized skill for Antigravity to perform complex tasks by splitting them into parallel sub-components and finishing with a linkage/integrity review.
---

# Parallel Multi-Tasking Workflow Skill

This skill enables Antigravity to maximize speed and efficiency by utilizing parallel execution for independent tasks while maintaining high quality through a final integration review.

## Core Principles
1.  **Independence Isolation**: Identify components of a task that do not depend on each other's intermediate state.
2.  **Parallel Execution**: Use `waitForPreviousTools: false` for all non-dependent actions (reading, researching, background testing).
3.  **Turbo Execution**: Use the `// turbo` annotation for shell commands that are safe to auto-run.
4.  **Integrity Scanning**: A dedicated final step to sync all splitted parts, verify imports, and check shared state.

## Implementation Guide

### Stage 1: Partitioning
Divide the workflow into "Parallel Zones".
*   Zone A: File Reading & Research
*   Zone B: Module Implementation (Independent files)
*   Zone C: Style & Frontend
*   *Note: Mark all tools in these zones with `waitForPreviousTools: false`.*

### Stage 2: Concurrent Execution
Trigger all tools in parallel zones in a single tool-calling turn.

### Stage 3: Linkage & Review
Verify that:
-   Import paths in new files match existing structure.
-   Shared variables across files are consistent.
-   Overall application build succeeds.

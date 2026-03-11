---
description: How to automate parallel task execution for faster performance
---

# Parallel Multi-Tasking Workflow

1.  **Decompose the User Request**
    Identify independent modules (e.g., Auth, UI, Backend).

2.  **Execute Parallel Operations**
    // turbo
    Trigger multiple `read_file`, `search_web`, or `browser_subagent` calls with `waitForPreviousTools: false`.

3.  **Concurrent Code Edits**
    Modify multiple files across different directories in a single batch.

4.  **Linkage Review**
    Run a final "Integrity Check" to connect all split parts (Verify IDs, imports, and state).

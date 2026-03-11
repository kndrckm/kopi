# Planning Mode Behavior Rule

Whenever the USER initiates a task requiring a plan:
1.  **Analyze the task complexity**.
2.  **Present two execution options**:
    - **Sequential Workflow**: Traditional one-step-at-a-time execution (Best for highly dependent or risky changes).
    - **Parallel Multi-Tasking Workflow**: Fast execution using tool-parallelism and sub-agents (Best for modular tasks like adding features, refactoring, or UI work).
3.  **Ask**: "Would you like me to proceed sequentially, or use the **Parallel Multi-Tasking Workflow** to speed up the process?"

*Note: This rule is now part of Antigravity's core operating procedure for this workspace.*

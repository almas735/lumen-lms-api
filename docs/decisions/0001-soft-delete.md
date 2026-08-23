# Decision: Soft delete for users and courses

**Context:** Foundations.pdf requires soft deletes (deleted_at) for things people own and lose - users and courses.

**Options considered:**
1. Hard delete - simplest, but destroys history and breaks foreign keys pointing at the row.
2. Soft delete with a deleted_at timestamp - row stays, gets filtered out of normal queries.

**Decision:** Soft delete for both `users` and `courses`.

**Why:** A deleted instructor's published courses should not vanish unexpectedly, and an admin needs to be able to reason about "who used to have access" for support requests later. Every query that lists users or courses filters `deletedAt: null` explicitly in application code, rather than relying on a database view, so it stays visible and obvious when reading the code.

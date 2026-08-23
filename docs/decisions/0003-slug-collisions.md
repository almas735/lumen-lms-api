# Decision: Slug collision handling

**Context:** Course slugs must be unique and URL-safe. Two different instructors can title a course the exact same thing.

**Decision:** Slugify the title, then on collision append `-2`, `-3`, and so on, checking the database each time before settling on one.

**Why:** Keeps URLs short and readable instead of falling back to a random suffix or the raw course ID. The check-then-append loop is simple and correct at this project's scale. It would only need a database-level lock if we expected many instructors publishing the identical title in the same instant, which is not a realistic scenario here.

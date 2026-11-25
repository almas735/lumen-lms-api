# Lumen LMS API
[![CI](https://github.com/almas735/lumen-lms-api/actions/workflows/ci.yml/badge.svg)](https://github.com/almas735/lumen-lms-api/actions/workflows/ci.yml)

Express + TypeScript + Prisma + PostgreSQL.

## Setup
1. `docker compose up -d`
2. `pnpm install`
3. Copy `.env.example` to `.env`
4. `pnpm exec prisma migrate dev`
5. `pnpm exec prisma db seed`
6. `pnpm dev` — runs on http://localhost:4000

## Testing
`pnpm test` — Vitest + Supertest, covers all auth paths.

Direct API testing: see the Postman collection for manual/scripted requests independent of the frontend.

Frontend repo: https://github.com/almas735/lumen-lms-web

## Running the tests

The API tests use their own database, `lumen_test`, so they never touch your development data.

One-time setup (the Postgres container must be running):

    docker compose exec postgres psql -U postgres -c "CREATE DATABASE lumen_test;"
    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lumen_test pnpm exec prisma migrate deploy

Run them:

    pnpm test

What happens when you run them:

- Before the run, every table in `lumen_test` is emptied, so every run starts clean.
- The test database address comes from `TEST_DATABASE_URL` (see `.env.example`). If it is not set, the default is `lumen_test` on localhost.
- If the database name does not end in `_test`, the run stops straight away with "Refusing to run tests". This protects your real data.
- Test files run one after another, because they share one database.

After you add a migration, apply it to the test database again with the `migrate deploy` command above.

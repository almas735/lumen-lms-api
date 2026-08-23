# Lumen LMS API

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

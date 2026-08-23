# Lumen LMS - API Contract

Base URL (development): `http://localhost:4000`

All list endpoints return: `{ "data": [...], "meta": { "page": 1, "pageSize": 12, "total": 20, "totalPages": 2 } }`

All errors return: `{ "error": { "code": "SOME_CODE", "message": "Human readable message", "details": [{ "field": "email", "message": "..." }] } }` - `details` is only present for validation errors.

## Auth

### POST /api/auth/register
Body: `{ fullName, email, password, role }` - role must be `STUDENT` or `INSTRUCTOR`.
- `201` - `{ user }`, sets access_token and refresh_token cookies
- `400` - validation error
- `409` - `EMAIL_TAKEN`

### POST /api/auth/login
Body: `{ email, password }`
- `200` - `{ user }`, sets cookies
- `401` - `INVALID_CREDENTIALS`
- `429` - `TOO_MANY_ATTEMPTS` (6 failed attempts per email in 15 minutes)

### POST /api/auth/refresh
No body. Reads refresh_token cookie, rotates it.
- `200` - `{ user }`, new cookies set
- `401` - session expired

### POST /api/auth/logout
- `204` - cookies cleared, refresh token revoked in the database

### GET /api/auth/me
- `200` - `{ user }`
- `401` - not logged in

## Courses

### GET /api/courses
Public. Query params: `page`, `search`, `level`.
- `200` - paginated list of published courses only

### GET /api/instructor/courses
Instructor only. Query: `status` (DRAFT/PUBLISHED/ARCHIVED).
- `200` - `{ data }`, the caller's own courses including drafts

### POST /api/courses
Instructor only.
Body: `{ title, summary, description?, level, thumbnailUrl? }`
- `201` - `{ course }`, always created as DRAFT

### GET /api/courses/:slug
Public for published courses. Owner or admin only for draft/archived.
- `200` - `{ course }`
- `404` - not found, or not visible to this caller

### PATCH /api/courses/:id
Owner or admin only.
- `200` - `{ course }`
- `403` - not the owner

### DELETE /api/courses/:id
Owner or admin only. Soft delete.
- `204`

### POST /api/courses/:id/publish
Owner or admin only. Requires title, summary, and description all present.
- `200` - `{ course }`
- `400` - `INCOMPLETE_COURSE`, with details listing the missing fields
- `409` - `MUST_UNARCHIVE_FIRST`

### POST /api/courses/:id/unpublish
- `200` - `{ course }`

### POST /api/courses/:id/archive
- `200` - `{ course }`

## Admin

### GET /api/admin/users
Admin only. Query: `search`.
- `200` - `{ data }`

### PATCH /api/admin/users/:id/role
Admin only. Body: `{ role }`
- `200` - `{ user }`
- `400` - `CANNOT_CHANGE_OWN_ROLE`

### DELETE /api/admin/users/:id
Admin only. Soft delete.
- `204`
- `409` - `HAS_PUBLISHED_COURSES`, blocked if the instructor still has published courses

## Health

### GET /api/health
- `200` - `{ status: "ok" }`

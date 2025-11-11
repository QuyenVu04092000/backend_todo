# Nested Todo Backend

A production-ready Todo List backend built with Express.js, Prisma, and PostgreSQL. It supports nested todos, automatic timeline aggregation, and optional image uploads stored on disk. An Insomnia collection is provided for quick API exploration.

## Features

- Nested todos (unlimited depth) with parent ↔ subtodo relationships
- Automatic timeline calculation for parents based on subtodos
- Three-state todo workflow (TODO, IN_PROGRESS, DONE) with nested rollups
- Optional image upload per todo via Multer (stored under `src/uploads`)
- RESTful CRUD endpoints with consistent JSON responses
- CORS enabled for easy frontend integration
- Insomnia collection with prepared requests

## Requirements

- Node.js 18+
- PostgreSQL instance

## Quick Start

```bash
npm install
cp .env.example .env # then adjust credentials
npm run migrate
npm run dev
```

By default the API listens on `http://localhost:3000`.

## Environment Variables

| Variable      | Description                                    |
| ------------- | ---------------------------------------------- |
| `DATABASE_URL`| PostgreSQL connection string                   |
| `PORT`        | Port to run the HTTP server (defaults to 3000) |

## Prisma

- Apply migrations: `npm run migrate`
- Open Prisma Studio: `npm run studio`

> Both commands reference the schema located at `src/prisma/schema.prisma`.

## API Overview

All responses share the format:

```json
{
  "success": true,
  "data": {},
  "message": ""
}
```

### Create Root Todo
```bash
curl -X POST http://localhost:3000/api/todos \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Plan vacation",
    "description": "Summer trip",
    "startDate": "2026-06-01T00:00:00.000Z",
    "endDate": "2026-06-15T00:00:00.000Z"
  }'
```

### Create Subtodo with Image
```bash
curl -X POST http://localhost:3000/api/todos \
  -F "title=Book flights" \
  -F "parentId=1" \
  -F "startDate=2026-05-15T00:00:00.000Z" \
  -F "endDate=2026-05-20T00:00:00.000Z" \
  -F "image=@/path/to/image.png"
```

### List Todos (Nested)
```bash
curl http://localhost:3000/api/todos
```

### Get Single Todo (with subtodos)
```bash
curl http://localhost:3000/api/todos/1
```

### Update Todo (without subtodos)
```bash
curl -X PUT http://localhost:3000/api/todos/1 \
  -H "Content-Type: application/json" \
  -d '{"description":"Updated details"}'
```

### Update Todo Status
```bash
curl -X PATCH http://localhost:3000/api/todos/1/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "IN_PROGRESS"
  }'
```

### Delete Todo
```bash
curl -X DELETE http://localhost:3000/api/todos/1
```

> Todos with subtodos derive their `startDate` and `endDate` automatically. Attempting to edit these fields directly will return a `400` error.
>
> Use the status endpoint to pivot between TODO (chưa làm), IN_PROGRESS (đang làm), and DONE (đã làm). Apply additional logic client-side if you want cascading behaviour for subtodos.

## Insomnia Collection

1. Open Insomnia and select **Application Menu → Import → From File**.
2. Choose `insomnia_collection.json` in the project root.
3. Adjust the `base_url` environment variable if necessary.

The collection contains ready-to-run requests for listing, fetching, creating (JSON and multipart), updating, and deleting todos.

## Project Structure

```
src/
├─ app.js
├─ server.js
├─ prisma/
│  ├─ client.js
│  └─ schema.prisma
├─ routes/
│  └─ todo.routes.js
├─ controllers/
│  └─ todo.controller.js
├─ middleware/
│  └─ upload.js
├─ utils/
│  └─ timeline.js
└─ uploads/
```

## Notes

- Uploaded files are served at `/uploads/<filename>`.
- Parent timelines refresh automatically whenever subtodos are created, updated, or deleted.
- Static assets and runtime data are stored inside `src/uploads`; ensure your deployment target persists this directory.

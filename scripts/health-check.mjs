#!/usr/bin/env node
/**
 * TodoList project health check script.
 * - Prisma migrate status & schema verification
 * - API endpoint validation
 * - Frontend NEXT_PUBLIC_API_URL verification
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

const BACKEND_DIR = path.resolve(process.cwd(), "backend");
const FRONTEND_DIR = path.resolve(process.cwd(), "todolist-frontend");

const prisma = new PrismaClient();

const EXPECTED_TODO_COLUMNS = [
  "id",
  "title",
  "description",
  "imageUrl",
  "startDate",
  "endDate",
  "status",
  "parentId",
  "createdAt",
  "updatedAt",
];

function logSection(title) {
  console.log("\n===", title, "===");
}

function runCommand(command) {
  try {
    const output = execSync(command, {
      cwd: BACKEND_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    return {
      success: false,
      output: error.stderr?.toString()?.trim() || error.message,
    };
  }
}

function loadEnvFiles() {
  const envPaths = [
    path.join(BACKEND_DIR, ".env"),
    path.join(FRONTEND_DIR, ".env"),
  ];

  const envValues = {};
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      Object.assign(envValues, dotenv.parse(fs.readFileSync(envPath)));
    }
  }
  return envValues;
}

async function verifyTodoColumns() {
  const rows = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Todo'
    ORDER BY column_name;
  `;
  const normalizedExpected = EXPECTED_TODO_COLUMNS.map((col) => col.toLowerCase()).sort();
  const dbColumns = rows.map((row) => row.column_name.toLowerCase()).sort();
  const missing = normalizedExpected.filter((col) => !dbColumns.includes(col));
  const unexpected = dbColumns.filter((col) => !normalizedExpected.includes(col));
  return { dbColumns, missing, unexpected };
}

async function fetchJson(url, init) {
  const start = Date.now();
  try {
    const res = await fetch(url, init);
    const duration = Date.now() - start;
    const body = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      duration,
      body,
      headers: Object.fromEntries(res.headers.entries()),
    };
  } catch (error) {
    const duration = Date.now() - start;
    return { ok: false, status: null, duration, error: error.message };
  }
}

async function main() {
  const envValues = loadEnvFiles();
  if (envValues.DATABASE_URL) {
    process.env.DATABASE_URL = envValues.DATABASE_URL;
  }

  const apiBase = envValues.API_BASE_URL || envValues.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://localhost:3000";

  logSection("Prisma migrate status");
  const statusResult = runCommand("npx prisma migrate status --schema src/prisma/schema.prisma");
  console.log(statusResult.output || (statusResult.success ? "No output" : "Command failed"));

  if (!statusResult.success) {
    console.log("⚠️  Failed to run migrate status. Verify Prisma is installed and DATABASE_URL is reachable.");
  } else {
    const lower = statusResult.output.toLowerCase();
    if (lower.includes("drift") || lower.includes("not in sync")) {
      console.log("⚠️  Schema drift detected. Consider running `npx prisma migrate dev` or `npx prisma migrate reset` (reset will wipe data).");
    } else {
      console.log("✅ Prisma schema and database are in sync.");
    }
  }

  logSection("Todo table columns");
  try {
    const { dbColumns, missing, unexpected } = await verifyTodoColumns();
    console.log("Columns:", dbColumns.join(", "));
    if (missing.length === 0 && unexpected.length === 0) {
      console.log("✅ Todo table matches expected schema.");
    } else {
      if (missing.length) {
        console.log("⚠️  Missing columns:", missing.join(", "));
      }
      if (unexpected.length) {
        console.log("⚠️  Unexpected columns:", unexpected.join(", "));
      }
    }
  } catch (error) {
    console.log("⚠️  Unable to verify columns:", error.message);
  }

  logSection("Backend API health");
  console.log("Using base URL:", apiBase);

  const listResult = await fetchJson(`${apiBase}/api/todos`);
  console.log("GET /api/todos →", listResult.status, `${listResult.duration}ms`);
  if (!listResult.ok) {
    console.log("Response:", listResult.error || listResult.body);
  } else if (!Array.isArray(listResult.body)) {
    console.log("⚠️  Expected an array, received:", listResult.body);
  } else {
    console.log(`✅ Received ${listResult.body.length} todos.`);
  }

  let sampleId = null;
  if (Array.isArray(listResult.body) && listResult.body.length > 0) {
    sampleId = listResult.body[0].id;
  }

  if (sampleId != null) {
    const detailResult = await fetchJson(`${apiBase}/api/todos/${sampleId}`);
    console.log(`GET /api/todos/${sampleId} →`, detailResult.status, `${detailResult.duration}ms`);
    if (!detailResult.ok) {
      console.log("Response:", detailResult.error || detailResult.body);
    } else if (!detailResult.body || typeof detailResult.body !== "object") {
      console.log("⚠️  Expected an object, received:", detailResult.body);
    } else {
      console.log("✅ Todo detail retrieved with keys:", Object.keys(detailResult.body).join(", "));
    }

    const nextStatus =
      detailResult.body?.status === "DONE"
        ? "TODO"
        : detailResult.body?.status === "IN_PROGRESS"
        ? "DONE"
        : "IN_PROGRESS";
    const statusResult = await fetchJson(`${apiBase}/api/todos/${sampleId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    console.log(`PATCH /api/todos/${sampleId}/status →`, statusResult.status, `${statusResult.duration}ms`);
    if (!statusResult.ok) {
      console.log("Response:", statusResult.error || statusResult.body);
    } else if (!statusResult.body || typeof statusResult.body !== "object") {
      console.log("⚠️  Expected updated todo object, received:", statusResult.body);
    } else {
      console.log("✅ Updated todo status:", statusResult.body.status);
    }
  } else {
    console.log("ℹ️  No todos found to test detail/toggle endpoints. Create a todo first.");
  }

  logSection("Frontend NEXT_PUBLIC_API_URL check");
  if (envValues.NEXT_PUBLIC_API_URL) {
    console.log("Frontend NEXT_PUBLIC_API_URL:", envValues.NEXT_PUBLIC_API_URL);
    const frontFetch = await fetchJson(`${envValues.NEXT_PUBLIC_API_URL}/api/todos`);
    if (!frontFetch.ok) {
      console.log("⚠️  Frontend fetch failed:", frontFetch.error || frontFetch.body);
    } else {
      console.log(`✅ Frontend base URL reachable (${frontFetch.status}) with ${Array.isArray(frontFetch.body) ? frontFetch.body.length : "unknown"} todos.`);
    }
  } else {
    console.log("⚠️  NEXT_PUBLIC_API_URL not set in frontend .env. Frontend build may not reach the backend API.");
  }
}

main()
  .catch((err) => {
    console.error("Health check failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

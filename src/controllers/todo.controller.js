import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import prisma from "../prisma/client.js";
import { updateParentTimelines } from "../utils/timeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "../uploads");

const parseTodoId = (value) => {
  const id = Number.parseInt(value, 10);
  if (Number.isNaN(id) || id <= 0) {
    const error = new Error("Todo id must be a positive integer");
    error.statusCode = 400;
    throw error;
  }
  return id;
};

const parseNullableDate = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${fieldName} must be a valid date string`);
    error.statusCode = 400;
    throw error;
  }
  return date;
};

const parseStatus = (value, required = false) => {
  if (typeof value === "undefined" || value === null || value === "") {
    if (required) {
      const error = new Error("Status is required");
      error.statusCode = 400;
      throw error;
    }
    return undefined;
  }
  const normalized = String(value).trim().toUpperCase();
  if (!["TODO", "IN_PROGRESS", "DONE"].includes(normalized)) {
    const error = new Error("Status must be TODO, IN_PROGRESS, or DONE");
    error.statusCode = 400;
    throw error;
  }
  return normalized;
};

const assertValidTimeline = (startDate, endDate) => {
  if (startDate && endDate && startDate > endDate) {
    const error = new Error("startDate must be before or equal to endDate");
    error.statusCode = 400;
    throw error;
  }
};

const normalizeTodo = (todo) => ({
  id: todo.id,
  title: todo.title,
  description: todo.description,
  imageUrl: todo.imageUrl,
  startDate: todo.startDate,
  endDate: todo.endDate,
  status: todo.status,
  parentId: todo.parentId,
  createdAt: todo.createdAt,
  updatedAt: todo.updatedAt,
  subtodos: [],
});

const collectDescendantIds = async (client, rootId) => {
  const ids = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    const children = await client.todo.findMany({
      where: { parentId: current },
      select: { id: true },
    });
    for (const child of children) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
};

const buildTodoTree = (todos) => {
  const map = new Map();
  const nodes = todos.map((todo) => {
    const node = normalizeTodo(todo);
    map.set(node.id, node);
    return node;
  });

  const roots = [];

  nodes.forEach((node) => {
    if (node.parentId) {
      const parent = map.get(node.parentId);
      if (parent) {
        parent.subtodos.push(node);
      }
    } else {
      roots.push(node);
    }
  });

  return { roots, map };
};

const removeImageIfExists = (imageUrl) => {
  if (!imageUrl) return;
  const relativePath = imageUrl.startsWith("/") ? imageUrl.slice(1) : imageUrl;
  const absolutePath = path.resolve(__dirname, "..", relativePath);
  if (absolutePath.startsWith(uploadsDir) && fs.existsSync(absolutePath)) {
    fs.unlink(absolutePath, () => {});
  }
};

export const listTodos = async (_req, res, next) => {
  try {
    const todos = await prisma.todo.findMany({
      orderBy: { createdAt: "asc" },
    });
    const { roots } = buildTodoTree(todos);
    res
      .status(200)
      .json({ success: true, data: roots, message: "Todos fetched successfully" });
  } catch (error) {
    next(error);
  }
};

export const getTodo = async (req, res, next) => {
  try {
    const id = parseTodoId(req.params.id);
    const todos = await prisma.todo.findMany();
    const { map } = buildTodoTree(todos);
    const todo = map.get(id);

    if (!todo) {
      res.status(404).json({ success: false, data: null, message: "Todo not found" });
      return;
    }

    res
      .status(200)
      .json({ success: true, data: todo, message: "Todo fetched successfully" });
  } catch (error) {
    next(error);
  }
};

export const createTodo = async (req, res, next) => {
  try {
    const { title, description, parentId, status } = req.body;
    if (!title || typeof title !== "string") {
      const error = new Error("Title is required and must be a string");
      error.statusCode = 400;
      throw error;
    }

    let parentConnect = undefined;
    let parentIdentifier = null;
    if (typeof parentId !== "undefined" && parentId !== null && parentId !== "") {
      parentIdentifier = parseTodoId(parentId);
      const parent = await prisma.todo.findUnique({ where: { id: parentIdentifier } });
      if (!parent) {
        const error = new Error("Parent todo not found");
        error.statusCode = 404;
        throw error;
      }
      parentConnect = { connect: { id: parentIdentifier } };
    }

    const startDate = parseNullableDate(req.body.startDate, "startDate");
    const endDate = parseNullableDate(req.body.endDate, "endDate");
    assertValidTimeline(startDate, endDate);
    const parsedStatus = parseStatus(status);

    const data = {
      title: title.trim(),
      description: typeof description === "string" ? description.trim() : undefined,
      startDate,
      endDate,
      parent: parentConnect,
      status: parsedStatus,
    };

    if (req.file) {
      data.imageUrl = `/uploads/${req.file.filename}`;
    }

    const todo = await prisma.todo.create({
      data,
    });

    if (parentIdentifier) {
      await updateParentTimelines(parentIdentifier);
    }

    res.status(201).json({ success: true, data: todo, message: "Todo created successfully" });
  } catch (error) {
    next(error);
  }
};

export const updateTodo = async (req, res, next) => {
  try {
    const id = parseTodoId(req.params.id);
    const existing = await prisma.todo.findUnique({
      where: { id },
      include: {
        subtodos: {
          select: { id: true },
        },
      },
    });

    if (!existing) {
      res.status(404).json({ success: false, data: null, message: "Todo not found" });
      return;
    }

    const updates = {};
    const { title, description, startDate, endDate } = req.body;
    const statusInput = parseStatus(req.body.status);

    if (typeof title !== "undefined") {
      if (typeof title !== "string" || !title.trim()) {
        const error = new Error("Title must be a non-empty string when provided");
        error.statusCode = 400;
        throw error;
      }
      updates.title = title.trim();
    }

    if (typeof description !== "undefined") {
      if (description !== null && typeof description !== "string") {
        const error = new Error("Description must be a string or null");
        error.statusCode = 400;
        throw error;
      }
      updates.description = typeof description === "string" ? description.trim() : null;
    }

    const hasSubtodos = existing.subtodos.length > 0;

    if (hasSubtodos) {
      if (startDate !== undefined || endDate !== undefined) {
        const error = new Error("Cannot directly edit timeline of a todo with subtodos");
        error.statusCode = 400;
        throw error;
      }
    } else {
      if (startDate !== undefined) {
        updates.startDate = parseNullableDate(startDate, "startDate");
      }
      if (endDate !== undefined) {
        updates.endDate = parseNullableDate(endDate, "endDate");
      }

      const nextStartDate = Object.prototype.hasOwnProperty.call(updates, "startDate")
        ? updates.startDate
        : existing.startDate;
      const nextEndDate = Object.prototype.hasOwnProperty.call(updates, "endDate")
        ? updates.endDate
        : existing.endDate;
      assertValidTimeline(nextStartDate, nextEndDate);
    }

    if (typeof statusInput !== "undefined") {
      updates.status = statusInput;
    }

    if (req.file) {
      if (existing.imageUrl) {
        removeImageIfExists(existing.imageUrl);
      }
      updates.imageUrl = `/uploads/${req.file.filename}`;
    }

    if (Object.keys(updates).length === 0) {
      res
        .status(400)
        .json({ success: false, data: null, message: "No valid fields provided for update" });
      return;
    }

    const updated = await prisma.todo.update({
      where: { id },
      data: updates,
    });

    if (existing.parentId) {
      await updateParentTimelines(existing.parentId);
    }

    res.status(200).json({ success: true, data: updated, message: "Todo updated successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      res.status(404).json({ success: false, data: null, message: "Todo not found" });
      return;
    }
    next(error);
  }
};

export const updateTodoStatus = async (req, res, next) => {
  try {
    const id = parseTodoId(req.params.id);
    const status = parseStatus(req.body?.status, true);
    await prisma.$transaction(async (tx) => {
      await tx.todo.update({
        where: { id },
        data: { status },
      });

      if (status === "DONE") {
        const descendantIds = await collectDescendantIds(tx, id);
        if (descendantIds.length > 0) {
          await tx.todo.updateMany({
            where: { id: { in: descendantIds } },
            data: { status: "DONE" },
          });
        }
      }
    });

    const todos = await prisma.todo.findMany();
    const { map } = buildTodoTree(todos);
    const todo = map.get(id);

    if (!todo) {
      res.status(404).json({ success: false, data: null, message: "Todo not found" });
      return;
    }

    res
      .status(200)
      .json({ success: true, data: todo, message: "Todo status updated successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      res.status(404).json({ success: false, data: null, message: "Todo not found" });
      return;
    }
    next(error);
  }
};

export const deleteTodo = async (req, res, next) => {
  try {
    const id = parseTodoId(req.params.id);
    const existing = await prisma.todo.findUnique({
      where: { id },
      select: { id: true, parentId: true, imageUrl: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, data: null, message: "Todo not found" });
      return;
    }

    await prisma.todo.delete({ where: { id } });
    removeImageIfExists(existing.imageUrl);

    if (existing.parentId) {
      await updateParentTimelines(existing.parentId);
    }

    res.status(200).json({ success: true, data: null, message: "Todo deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      res.status(404).json({ success: false, data: null, message: "Todo not found" });
      return;
    }
    next(error);
  }
};

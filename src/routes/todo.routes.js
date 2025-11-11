import { Router } from "express";

import {
  listTodos,
  getTodo,
  createTodo,
  updateTodo,
  deleteTodo,
  updateTodoStatus,
} from "../controllers/todo.controller.js";
import upload from "../middleware/upload.js";

const router = Router();

router.get("/", listTodos);
router.get("/:id", getTodo);
router.post("/", upload.single("image"), createTodo);
router.put("/:id", upload.single("image"), updateTodo);
router.patch("/:id/status", updateTodoStatus);
router.delete("/:id", deleteTodo);

export default router;

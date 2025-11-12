import { Router } from "express";

import
{
  listTodos,
  createTodo,
  updateTodo,
  updateTodoStatus,
  updateTodoStatusesBatch,
  streamTodoEvents,
  deleteTodo,
} from "../controllers/todo.controller.js";
import authenticate from "../middleware/auth.js";
import upload from "../middleware/upload.js";

const router = Router();

router.get( "/stream", streamTodoEvents );

router.get( "/", authenticate, listTodos );
router.post( "/", authenticate, upload.single( "image" ), createTodo );
router.patch( "/batch-update", authenticate, updateTodoStatusesBatch );
router.post( "/status/batch", authenticate, updateTodoStatusesBatch );
router.patch( "/:id/status", authenticate, updateTodoStatus );
router.patch( "/:id", authenticate, updateTodo );
router.delete( "/:id", authenticate, deleteTodo );

export default router;

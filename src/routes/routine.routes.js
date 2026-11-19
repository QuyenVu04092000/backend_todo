import { Router } from "express";

import
{
  listRoutines,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  completeRoutine,
  uncompleteRoutine,
} from "../controllers/routine.controller.js";
import authenticate from "../middleware/auth.js";

const router = Router();

router.use( authenticate );

router.get( "/", listRoutines );
router.post( "/", createRoutine );
router.patch( "/:id", updateRoutine );
router.delete( "/:id", deleteRoutine );
router.put( "/:id/completions/:date", completeRoutine );
router.delete( "/:id/completions/:date", uncompleteRoutine );

export default router;

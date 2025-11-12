import { TimelineEventType } from "@prisma/client";

import prisma from "../prisma/client.js";

const pickClient = ( client ) => client ?? prisma;

/**
 * Create a timeline event for a todo.
 * @param {{
 *   todoId: number;
 *   type: TimelineEventType;
 *   message: string;
 *   actorUserId?: number | null;
 *   client?: import("@prisma/client").PrismaClient;
 * }} params
 * @returns {Promise<void>}
 */
export const createTimelineEvent = async ( {
  todoId,
  type,
  message,
  actorUserId = null,
  client,
} ) =>
{
  const db = pickClient( client );
  await db.todoTimeline.create( {
    data: {
      todoId,
      type,
      message,
      actorUserId,
    },
  } );
};

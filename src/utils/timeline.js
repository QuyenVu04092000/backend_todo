import prisma from "../prisma/client.js";

/**
 * Compute aggregate timeline values from subtodos.
 * @param {Array<{ startDate: Date | null, endDate: Date | null }>} subtodos
 * @returns {{ startDate: Date | null, endDate: Date | null }}
 */
export const computeTimelineFromSubtodos = (subtodos) => {
  if (!Array.isArray(subtodos) || subtodos.length === 0) {
    return { startDate: null, endDate: null };
  }

  const startDates = subtodos
    .map((todo) => todo.startDate)
    .filter((value) => value instanceof Date);
  const endDates = subtodos
    .map((todo) => todo.endDate)
    .filter((value) => value instanceof Date);

  const startDate = startDates.length
    ? new Date(Math.min(...startDates.map((date) => date.getTime())))
    : null;
  const endDate = endDates.length
    ? new Date(Math.max(...endDates.map((date) => date.getTime())))
    : null;

  return { startDate, endDate };
};

/**
 * Recursively update parent todos timeline based on their subtodos.
 * @param {number | null | undefined} parentId
 * @returns {Promise<void>}
 */
export const updateParentTimelines = async (parentId) => {
  if (!parentId) return;

  const parent = await prisma.todo.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      parentId: true,
      subtodos: {
        select: {
          startDate: true,
          endDate: true,
        },
      },
    },
  });

  if (!parent) return;

  const { startDate, endDate } = computeTimelineFromSubtodos(parent.subtodos);

  await prisma.todo.update({
    where: { id: parent.id },
    data: {
      startDate,
      endDate,
    },
  });

  if (parent.parentId) {
    await updateParentTimelines(parent.parentId);
  }
};

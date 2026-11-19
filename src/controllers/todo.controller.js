import jwt from "jsonwebtoken";
import { TimelineEventType } from "@prisma/client";

import prisma from "../prisma/client.js";
import { createTimelineEvent } from "../utils/timeline.js";
import todoEvents from "../events/todoEvents.js";
import { uploadToSupabase, deleteFromSupabase } from "../utils/supabase.js";

const ensureJwtSecret = () =>
{
  const secret = process.env.JWT_SECRET;
  if ( !secret )
  {
    throw new Error( "JWT_SECRET is not configured" );
  }
  return secret;
};

const SSE_HEARTBEAT_INTERVAL = 30_000;

/**
 * @type {Set<{ userId: number, res: import("express").Response, heartbeat: NodeJS.Timeout }>}
 */
const activeSseClients = new Set();

const broadcastChange = ( userId, payload ) =>
{
  todoEvents.emit( "change", { userId, ...payload } );
};

todoEvents.on( "change", ( event ) =>
{
  for ( const client of Array.from( activeSseClients ) )
  {
    if ( client.userId !== event.userId )
    {
      continue;
    }

    if ( client.res.writableEnded )
    {
      clearInterval( client.heartbeat );
      activeSseClients.delete( client );
      continue;
    }

    try
    {
      client.res.write( `data: ${ JSON.stringify( event ) }\n\n` );
    } catch
    {
      clearInterval( client.heartbeat );
      activeSseClients.delete( client );
    }
  }
} );

const parseTodoId = ( value ) =>
{
  const id = Number.parseInt( value, 10 );
  if ( Number.isNaN( id ) || id <= 0 )
  {
    const error = new Error( "Todo id must be a positive integer" );
    error.statusCode = 400;
    throw error;
  }
  return id;
};

const parseNullableDate = ( value, fieldName ) =>
{
  if ( value === undefined || value === null || value === "" )
  {
    return null;
  }
  const date = new Date( value );
  if ( Number.isNaN( date.getTime() ) )
  {
    const error = new Error( `${ fieldName } must be a valid date string` );
    error.statusCode = 400;
    throw error;
  }
  return date;
};

const parseStatus = ( value, required = false ) =>
{
  if ( typeof value === "undefined" || value === null || value === "" )
  {
    if ( required )
    {
      const error = new Error( "Status is required" );
      error.statusCode = 400;
      throw error;
    }
    return undefined;
  }
  const normalized = String( value ).trim().toUpperCase();
  if ( ![ "TODO", "IN_PROGRESS", "DONE" ].includes( normalized ) )
  {
    const error = new Error( "Status must be TODO, IN_PROGRESS, or DONE" );
    error.statusCode = 400;
    throw error;
  }
  return normalized;
};

const assertValidTimeline = ( startDate, endDate ) =>
{
  if ( startDate && endDate && startDate > endDate )
  {
    const error = new Error( "startDate must be before or equal to endDate" );
    error.statusCode = 400;
    throw error;
  }
};

const sanitizeTimeline = ( timelineEvents = [] ) =>
  timelineEvents.map( ( event ) => ( {
    id: event.id,
    type: event.type,
    message: event.message,
    actorUserId: event.actorUserId,
    createdAt: event.createdAt,
  } ) );

const normalizeTodo = ( todo ) => ( {
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
  timeline: sanitizeTimeline( todo.timelineEvents ),
  subtodos: [],
} );

const buildTodoTree = ( todos ) =>
{
  const map = new Map();
  const nodes = todos.map( ( todo ) =>
  {
    const node = normalizeTodo( todo );
    map.set( node.id, node );
    return node;
  } );

  const roots = [];

  nodes.forEach( ( node ) =>
  {
    if ( node.parentId )
    {
      const parent = map.get( node.parentId );
      if ( parent )
      {
        parent.subtodos.push( node );
      }
    } else
    {
      roots.push( node );
    }
  } );

  return { roots, map };
};

const fetchTodoTreeForUser = async ( userId ) =>
{
  const todos = await prisma.todo.findMany( {
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      timelineEvents: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  } );

  return buildTodoTree( todos );
};

const collectDescendantIds = async ( client, rootId, userId ) =>
{
  const ids = [];
  const queue = [ rootId ];

  while ( queue.length > 0 )
  {
    const current = queue.shift();
    const children = await client.todo.findMany( {
      where: { parentId: current, userId },
      select: { id: true },
    } );

    for ( const child of children )
    {
      ids.push( child.id );
      queue.push( child.id );
    }
  }

  return ids;
};

export const listTodos = async ( req, res, next ) =>
{
  try
  {
    const userId = req.user.id;
    const { roots } = await fetchTodoTreeForUser( userId );
    res.status( 200 ).json( {
      success: true,
      data: roots,
      message: "Todos fetched successfully",
    } );
  } catch ( error )
  {
    next( error );
  }
};

export const getTodo = async ( req, res, next ) =>
{
  try
  {
    const userId = req.user.id;
    const id = parseTodoId( req.params.id );

    const { map } = await fetchTodoTreeForUser( userId );
    const todo = map.get( id );

    if ( !todo )
    {
      res.status( 404 ).json( { success: false, data: null, message: "Todo not found" } );
      return;
    }

    res.status( 200 ).json( {
      success: true,
      data: todo,
      message: "Todo fetched successfully",
    } );
  } catch ( error )
  {
    next( error );
  }
};

export const createTodo = async ( req, res, next ) =>
{
  try
  {
    const userId = req.user.id;
    const { title, description, parentId, status } = req.body;

    if ( !title || typeof title !== "string" )
    {
      const error = new Error( "Title is required and must be a string" );
      error.statusCode = 400;
      throw error;
    }

    let parentRecord = null;
    let parentIdentifier = null;

    if ( typeof parentId !== "undefined" && parentId !== null && parentId !== "" )
    {
      parentIdentifier = parseTodoId( parentId );
      parentRecord = await prisma.todo.findFirst( {
        where: { id: parentIdentifier, userId },
        select: { id: true, title: true, parentId: true },
      } );

      if ( !parentRecord )
      {
        const error = new Error( "Parent todo not found" );
        error.statusCode = 404;
        throw error;
      }

      // Subtodos are a flat checklist (like Todoist / MS To Do steps):
      // only one level of nesting is allowed.
      if ( parentRecord.parentId )
      {
        const error = new Error( "Subtodos cannot have their own subtodos" );
        error.statusCode = 400;
        throw error;
      }
    }

    let startDate = null;
    let endDate = null;

    if ( !parentRecord )
    {
      startDate = parseNullableDate( req.body.startDate, "startDate" );
      endDate = parseNullableDate( req.body.endDate, "endDate" );
      assertValidTimeline( startDate, endDate );
    }

    const parsedStatus = parseStatus( status );

    const data = {
      title: title.trim(),
      description: typeof description === "string" && description.trim()
        ? description.trim()
        : null,
      startDate,
      endDate,
      userId,
      parentId: parentIdentifier ?? undefined,
    };

    if ( typeof parsedStatus !== "undefined" )
    {
      data.status = parsedStatus;
    }

    // Only upload to Supabase if a file was actually provided
    if ( req.file && req.file.buffer && req.file.buffer.length > 0 )
    {
      const originalName = req.file.originalname || "image";
      const uniqueFilename = `${ Date.now() }-${ originalName }`;
      // Sanitize filename while preserving extension
      const sanitizedFilename = uniqueFilename.replace( /[^a-zA-Z0-9._-]/g, "_" );

      const { url } = await uploadToSupabase(
        req.file.buffer,
        sanitizedFilename,
        req.file.mimetype || "image/jpeg"
      );

      data.imageUrl = url;
    }

    const created = await prisma.todo.create( {
      data,
    } );

    await createTimelineEvent( {
      todoId: created.id,
      type: TimelineEventType.CREATED,
      message: parentRecord
        ? `Subtodo created under "${ parentRecord.title }"`
        : "Todo created",
      actorUserId: userId,
    } );

    if ( parentRecord )
    {
      await createTimelineEvent( {
        todoId: parentRecord.id,
        type: TimelineEventType.SUBTODO_ADDED,
        message: `Subtodo "${ data.title }" added`,
        actorUserId: userId,
      } );
    }

    const { map } = await fetchTodoTreeForUser( userId );
    const todo = map.get( created.id ) ?? normalizeTodo( {
      ...created,
      timelineEvents: [],
    } );

    if ( todo )
    {
      broadcastChange( userId, {
        type: "create",
        todos: [ todo ],
      } );
    }

    res.status( 201 ).json( {
      success: true,
      data: todo,
      message: "Todo created successfully",
    } );
  } catch ( error )
  {
    next( error );
  }
};

/**
 * PATCH /api/todos/:id — single "Save" endpoint for the todo detail screen.
 *
 * Accepts any subset of: title, description, startDate, endDate, status,
 * image (multipart file) / imageUrl ("" | "null" to remove).
 * Everything is validated first, then the image is uploaded, then all DB
 * writes (todo + timeline events + DONE cascade) happen in one transaction.
 * Sending nothing that differs from the stored todo returns 200 unchanged.
 */
export const updateTodo = async ( req, res, next ) =>
{
  let uploadedImageUrl = null;

  try
  {
    const userId = req.user.id;
    const id = parseTodoId( req.params.id );

    const existing = await prisma.todo.findFirst( {
      where: { id, userId },
    } );

    if ( !existing )
    {
      res.status( 404 ).json( { success: false, data: null, message: "Todo not found" } );
      return;
    }

    // FormData fields arrive as strings; JSON bodies may contain null.
    const { title, description, startDate, endDate, imageUrl } = req.body ?? {};
    const status = parseStatus( req.body?.status );

    const updates = {};
    const changedFields = [];
    const isSubtodo = Boolean( existing.parentId );
    let timelineChanged = false;

    // ---- 1. Validate & diff every field (no side effects yet) ----

    if ( typeof title !== "undefined" )
    {
      if ( typeof title !== "string" || !title.trim() )
      {
        const error = new Error( "Title must be a non-empty string when provided" );
        error.statusCode = 400;
        throw error;
      }
      const trimmed = title.trim();
      if ( trimmed !== existing.title )
      {
        updates.title = trimmed;
        changedFields.push( "title" );
      }
    }

    if ( typeof description !== "undefined" )
    {
      if ( description !== null && typeof description !== "string" )
      {
        const error = new Error( "Description must be a string or null" );
        error.statusCode = 400;
        throw error;
      }
      const normalizedDescription =
        typeof description === "string" && description.trim() && description.trim() !== "null"
          ? description.trim()
          : null;
      if ( normalizedDescription !== existing.description )
      {
        updates.description = normalizedDescription;
        changedFields.push( "description" );
      }
    }

    // Subtodos are checklist items: they never carry their own timeline.
    if ( !isSubtodo )
    {
      const sameDate = ( a, b ) =>
        ( !a && !b ) || ( a && b && a.getTime() === b.getTime() );

      if ( typeof startDate !== "undefined" )
      {
        const parsed = parseNullableDate( startDate === "null" ? null : startDate, "startDate" );
        if ( !sameDate( parsed, existing.startDate ) )
        {
          updates.startDate = parsed;
          timelineChanged = true;
        }
      }

      if ( typeof endDate !== "undefined" )
      {
        const parsed = parseNullableDate( endDate === "null" ? null : endDate, "endDate" );
        if ( !sameDate( parsed, existing.endDate ) )
        {
          updates.endDate = parsed;
          timelineChanged = true;
        }
      }
    }

    const nextStart = "startDate" in updates ? updates.startDate : existing.startDate;
    const nextEnd = "endDate" in updates ? updates.endDate : existing.endDate;
    if ( timelineChanged )
    {
      assertValidTimeline( nextStart, nextEnd );
    }

    const statusChanged = typeof status !== "undefined" && status !== existing.status;
    if ( statusChanged )
    {
      updates.status = status;
    }

    const hasNewImage = Boolean( req.file?.buffer?.length );
    const wantsImageRemoval =
      !hasNewImage &&
      typeof imageUrl !== "undefined" &&
      ( imageUrl === null || String( imageUrl ).trim() === "" || imageUrl === "null" ) &&
      Boolean( existing.imageUrl );

    if ( Object.keys( updates ).length === 0 && !hasNewImage && !wantsImageRemoval )
    {
      const { map } = await fetchTodoTreeForUser( userId );
      res.status( 200 ).json( {
        success: true,
        data: map.get( id ),
        message: "No changes to save",
      } );
      return;
    }

    // ---- 2. Upload new image (only after validation passed) ----

    if ( hasNewImage )
    {
      const originalName = req.file.originalname || "image";
      const sanitizedFilename = `${ Date.now() }-${ originalName }`.replace( /[^a-zA-Z0-9._-]/g, "_" );
      const { url } = await uploadToSupabase(
        req.file.buffer,
        sanitizedFilename,
        req.file.mimetype || "image/jpeg"
      );
      uploadedImageUrl = url;
      updates.imageUrl = url;
      changedFields.push( "image" );
    }
    else if ( wantsImageRemoval )
    {
      updates.imageUrl = null;
      changedFields.push( "image" );
    }

    // ---- 3. Apply everything atomically ----

    await prisma.$transaction( async ( tx ) =>
    {
      await tx.todo.update( { where: { id }, data: updates } );

      const fieldNames = changedFields.filter( ( f ) => f !== "image" );
      if ( changedFields.length > 0 )
      {
        const message = changedFields.includes( "image" )
          ? fieldNames.length > 0
            ? `Updated ${ fieldNames.join( ", " ) } and image`
            : updates.imageUrl ? "Image updated" : "Image removed"
          : `Updated ${ fieldNames.join( ", " ) }`;

        await createTimelineEvent( {
          todoId: id,
          type: changedFields.length === 1 && changedFields[ 0 ] === "image"
            ? TimelineEventType.IMAGE_UPDATED
            : TimelineEventType.UPDATED,
          message,
          actorUserId: userId,
          client: tx,
        } );
      }

      if ( timelineChanged )
      {
        const message =
          nextStart && nextEnd
            ? `Timeline updated to ${ nextStart.toISOString() } → ${ nextEnd.toISOString() }`
            : nextStart
              ? `Timeline updated. Start: ${ nextStart.toISOString() }, no end date`
              : nextEnd
                ? `Timeline updated. End: ${ nextEnd.toISOString() }, no start date`
                : "Timeline cleared";

        await createTimelineEvent( {
          todoId: id,
          type: TimelineEventType.TIMELINE_UPDATED,
          message,
          actorUserId: userId,
          client: tx,
        } );
      }

      if ( statusChanged )
      {
        await createTimelineEvent( {
          todoId: id,
          type: TimelineEventType.STATUS_CHANGED,
          message: `Status changed from ${ existing.status } to ${ status }`,
          actorUserId: userId,
          client: tx,
        } );

        if ( status === "DONE" )
        {
          const descendantIds = await collectDescendantIds( tx, id, userId );
          if ( descendantIds.length > 0 )
          {
            await tx.todo.updateMany( {
              where: { id: { in: descendantIds } },
              data: { status },
            } );
          }
        }
      }
    } );

    // Old image is only deleted once the DB no longer points at it.
    if ( "imageUrl" in updates && existing.imageUrl )
    {
      await deleteFromSupabase( existing.imageUrl );
    }

    const { map } = await fetchTodoTreeForUser( userId );
    const todo = map.get( id );

    if ( todo )
    {
      broadcastChange( userId, {
        type: "update",
        todos: [ todo ],
      } );
    }

    res.status( 200 ).json( {
      success: true,
      data: todo,
      message: "Todo updated successfully",
    } );
  } catch ( error )
  {
    // Roll back an image we uploaded if the DB write failed.
    if ( uploadedImageUrl )
    {
      await deleteFromSupabase( uploadedImageUrl ).catch( () => {} );
    }
    if ( error?.code === "P2025" )
    {
      res.status( 404 ).json( { success: false, data: null, message: "Todo not found" } );
      return;
    }
    next( error );
  }
};

export const updateTodoStatus = async ( req, res, next ) =>
{
  try
  {
    const userId = req.user.id;
    const id = parseTodoId( req.params.id );
    const status = parseStatus( req.body?.status, true );

    const existing = await prisma.todo.findFirst( {
      where: { id, userId },
      select: {
        id: true,
        status: true,
        parentId: true,
        title: true,
      },
    } );

    if ( !existing )
    {
      res.status( 404 ).json( { success: false, data: null, message: "Todo not found" } );
      return;
    }

    if ( existing.status === status )
    {
      const { map } = await fetchTodoTreeForUser( userId );
      res.status( 200 ).json( {
        success: true,
        data: map.get( id ),
        message: "Todo status updated successfully",
      } );
      return;
    }

    await prisma.$transaction( async ( tx ) =>
    {
      await tx.todo.update( {
        where: { id },
        data: { status },
      } );

      await createTimelineEvent( {
        todoId: id,
        type: TimelineEventType.STATUS_CHANGED,
        message: `Status changed from ${ existing.status } to ${ status }`,
        actorUserId: userId,
        client: tx,
      } );

      if ( status === "DONE" )
      {
        const descendantIds = await collectDescendantIds( tx, id, userId );
        if ( descendantIds.length > 0 )
        {
          await tx.todo.updateMany( {
            where: { id: { in: descendantIds } },
            data: { status },
          } );
        }
      }
    } );

    const { map } = await fetchTodoTreeForUser( userId );
    const todo = map.get( id );

    if ( todo )
    {
      broadcastChange( userId, {
        type: "status_single",
        todos: [ todo ],
      } );
    }

    res.status( 200 ).json( {
      success: true,
      data: todo,
      message: "Todo status updated successfully",
    } );
  } catch ( error )
  {
    if ( error?.code === "P2025" )
    {
      res.status( 404 ).json( { success: false, data: null, message: "Todo not found" } );
      return;
    }
    next( error );
  }
};

export const updateTodoStatusesBatch = async ( req, res, next ) =>
{
  try
  {
    const userId = req.user.id;
    const updatesInput = Array.isArray( req.body?.updates ) ? req.body.updates : null;

    if ( !updatesInput || updatesInput.length === 0 )
    {
      res.status( 400 ).json( {
        success: false,
        data: null,
        message: "updates array is required",
      } );
      return;
    }

    const normalizedUpdates = new Map();

    for ( const entry of updatesInput )
    {
      if ( !entry || typeof entry !== "object" )
      {
        const error = new Error( "Each update must be an object with id and status" );
        error.statusCode = 400;
        throw error;
      }
      const todoId = parseTodoId( entry.id );
      const status = parseStatus( entry.status, true );
      normalizedUpdates.set( todoId, status );
    }

    if ( normalizedUpdates.size === 0 )
    {
      res.status( 200 ).json( {
        success: true,
        data: [],
        message: "No status changes applied",
      } );
      return;
    }

    const processedIds = [];

    await prisma.$transaction( async ( tx ) =>
    {
      for ( const [ todoId, status ] of normalizedUpdates.entries() )
      {
        const existing = await tx.todo.findFirst( {
          where: { id: todoId, userId },
          select: {
            id: true,
            status: true,
            parentId: true,
            title: true,
          },
        } );

        if ( !existing )
        {
          const error = new Error( `Todo ${ todoId } not found` );
          error.statusCode = 404;
          throw error;
        }

        if ( existing.status === status )
        {
          continue;
        }

        await tx.todo.update( {
          where: { id: todoId },
          data: { status },
        } );

        await createTimelineEvent( {
          todoId,
          type: TimelineEventType.STATUS_CHANGED,
          message: `Status changed from ${ existing.status } to ${ status }`,
          actorUserId: userId,
          client: tx,
        } );

        if ( status === "DONE" )
        {
          const descendantIds = await collectDescendantIds( tx, todoId, userId );
          if ( descendantIds.length > 0 )
          {
            await tx.todo.updateMany( {
              where: { id: { in: descendantIds } },
              data: { status },
            } );
          }
        }

        processedIds.push( todoId );
      }
    } );

    if ( processedIds.length === 0 )
    {
      res.status( 200 ).json( {
        success: true,
        data: [],
        message: "No status changes applied",
      } );
      return;
    }

    const { map } = await fetchTodoTreeForUser( userId );
    const todos = processedIds
      .map( ( id ) => map.get( id ) )
      .filter( Boolean );

    broadcastChange( userId, {
      type: "status_batch",
      todos,
    } );

    res.status( 200 ).json( {
      success: true,
      data: todos,
      message: "Todo statuses updated successfully",
    } );
  } catch ( error )
  {
    if ( error?.code === "P2025" )
    {
      res.status( 404 ).json( { success: false, data: null, message: "Todo not found" } );
      return;
    }
    next( error );
  }
};

export const deleteTodo = async ( req, res, next ) =>
{
  try
  {
    const userId = req.user.id;
    const id = parseTodoId( req.params.id );

    const existing = await prisma.todo.findFirst( {
      where: { id, userId },
      select: { id: true, parentId: true, title: true, imageUrl: true },
    } );

    if ( !existing )
    {
      res.status( 404 ).json( { success: false, data: null, message: "Todo not found" } );
      return;
    }

    // Delete image from Supabase if it exists
    if ( existing.imageUrl )
    {
      await deleteFromSupabase( existing.imageUrl );
    }

    await prisma.todo.delete( { where: { id } } );

    if ( existing.parentId )
    {
      await createTimelineEvent( {
        todoId: existing.parentId,
        type: TimelineEventType.UPDATED,
        message: `Subtodo "${ existing.title }" deleted`,
        actorUserId: userId,
      } );
    }

    broadcastChange( userId, {
      type: "delete",
      removedIds: [ id ],
    } );

    res.status( 200 ).json( {
      success: true,
      data: null,
      message: "Todo deleted successfully",
    } );
  } catch ( error )
  {
    if ( error?.code === "P2025" )
    {
      res.status( 404 ).json( { success: false, data: null, message: "Todo not found" } );
      return;
    }
    next( error );
  }
};

export const streamTodoEvents = ( req, res ) =>
{
  try
  {
    const tokenParam = req.query?.token;
    const token = typeof tokenParam === "string" ? tokenParam : Array.isArray( tokenParam ) ? tokenParam[ 0 ] : null;

    if ( !token )
    {
      res.status( 401 ).json( { success: false, data: null, message: "Authentication required" } );
      return;
    }

    const payload = jwt.verify( token, ensureJwtSecret() );
    const rawId = typeof payload.userId !== "undefined" ? payload.userId : payload.sub;
    const userId = typeof rawId === "string" ? Number.parseInt( rawId, 10 ) : rawId;

    if ( !userId || Number.isNaN( userId ) )
    {
      res.status( 401 ).json( { success: false, data: null, message: "Invalid authentication token" } );
      return;
    }

    res.setHeader( "Content-Type", "text/event-stream" );
    res.setHeader( "Cache-Control", "no-cache" );
    res.setHeader( "Connection", "keep-alive" );

    if ( typeof res.flushHeaders === "function" )
    {
      res.flushHeaders();
    } else
    {
      res.write( "\n" );
    }

    res.write( `data: ${ JSON.stringify( { type: "connected", userId } ) }\n\n` );

    const heartbeat = setInterval( () =>
    {
      if ( !res.writableEnded )
      {
        res.write( ": heartbeat\n\n" );
      }
    }, SSE_HEARTBEAT_INTERVAL );

    const client = { userId, res, heartbeat };
    activeSseClients.add( client );

    req.on( "close", () =>
    {
      clearInterval( heartbeat );
      activeSseClients.delete( client );
    } );
  } catch ( error )
  {
    res.status( 401 ).json( { success: false, data: null, message: "Invalid authentication token" } );
  }
};


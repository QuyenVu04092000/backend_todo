import prisma from "../prisma/client.js";
import todoEvents from "../events/todoEvents.js";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALL_DAYS = [ 0, 1, 2, 3, 4, 5, 6 ];
const DEFAULT_HISTORY_DAYS = 120;

const badRequest = ( message ) =>
{
  const error = new Error( message );
  error.statusCode = 400;
  return error;
};

const notFound = () =>
{
  const error = new Error( "Routine not found" );
  error.statusCode = 404;
  return error;
};

/** Let other open tabs/devices of this user know routines changed (SSE). */
const broadcastRoutineChange = ( userId ) =>
{
  todoEvents.emit( "change", { userId, type: "routines" } );
};

const parseId = ( value ) =>
{
  const id = Number.parseInt( value, 10 );
  if ( Number.isNaN( id ) || id <= 0 )
  {
    throw badRequest( "Routine id must be a positive integer" );
  }
  return id;
};

const parseDateKey = ( value, fieldName = "date" ) =>
{
  if ( typeof value !== "string" || !DATE_KEY_PATTERN.test( value ) )
  {
    throw badRequest( `${ fieldName } must be in YYYY-MM-DD format` );
  }
  const parsed = new Date( `${ value }T00:00:00Z` );
  if ( Number.isNaN( parsed.getTime() ) || parsed.toISOString().slice( 0, 10 ) !== value )
  {
    throw badRequest( `${ fieldName } is not a valid calendar date` );
  }
  return value;
};

const parseOptionalString = ( value, fieldName, maxLength ) =>
{
  if ( value === undefined ) return undefined;
  if ( value === null ) return null;
  if ( typeof value !== "string" )
  {
    throw badRequest( `${ fieldName } must be a string` );
  }
  const trimmed = value.trim();
  if ( trimmed.length > maxLength )
  {
    throw badRequest( `${ fieldName } must be at most ${ maxLength } characters` );
  }
  return trimmed || null;
};

const parseDaysOfWeek = ( value ) =>
{
  if ( value === undefined ) return undefined;
  if ( !Array.isArray( value ) )
  {
    throw badRequest( "daysOfWeek must be an array of numbers 0-6" );
  }
  const days = Array.from( new Set( value.map( ( day ) => Number( day ) ) ) );
  if ( days.length === 0 || days.some( ( day ) => !ALL_DAYS.includes( day ) ) )
  {
    throw badRequest( "daysOfWeek must contain at least one day between 0 (Sun) and 6 (Sat)" );
  }
  return days.sort( ( a, b ) => a - b );
};

const parseTimeOfDay = ( value ) =>
{
  if ( value === undefined ) return undefined;
  if ( value === null || value === "" ) return null;
  if ( typeof value !== "string" || !TIME_PATTERN.test( value ) )
  {
    throw badRequest( "timeOfDay must be in HH:MM (24h) format" );
  }
  return value;
};

/** Build the writable fields shared by create and update. */
const parseRoutineInput = ( body, { requireTitle } ) =>
{
  const data = {};

  if ( requireTitle || body.title !== undefined )
  {
    if ( typeof body.title !== "string" || !body.title.trim() )
    {
      throw badRequest( "Title is required" );
    }
    if ( body.title.trim().length > 120 )
    {
      throw badRequest( "Title must be at most 120 characters" );
    }
    data.title = body.title.trim();
  }

  const description = parseOptionalString( body.description, "description", 1000 );
  if ( description !== undefined ) data.description = description;

  const emoji = parseOptionalString( body.emoji, "emoji", 16 );
  if ( emoji !== undefined ) data.emoji = emoji;

  const daysOfWeek = parseDaysOfWeek( body.daysOfWeek );
  if ( daysOfWeek !== undefined ) data.daysOfWeek = daysOfWeek;

  const timeOfDay = parseTimeOfDay( body.timeOfDay );
  if ( timeOfDay !== undefined ) data.timeOfDay = timeOfDay;

  if ( body.isActive !== undefined )
  {
    if ( typeof body.isActive !== "boolean" )
    {
      throw badRequest( "isActive must be a boolean" );
    }
    data.isActive = body.isActive;
  }

  return data;
};

const defaultFromDate = () =>
{
  const date = new Date();
  date.setUTCDate( date.getUTCDate() - DEFAULT_HISTORY_DAYS );
  return date.toISOString().slice( 0, 10 );
};

const serializeRoutine = ( routine ) => ( {
  id: routine.id,
  title: routine.title,
  description: routine.description,
  emoji: routine.emoji,
  daysOfWeek: routine.daysOfWeek,
  timeOfDay: routine.timeOfDay,
  isActive: routine.isActive,
  createdAt: routine.createdAt,
  updatedAt: routine.updatedAt,
  completions: ( routine.completions ?? [] ).map( ( item ) => item.date ),
} );

const findOwnedRoutine = async ( id, userId, from ) =>
  prisma.routine.findFirst( {
    where: { id, userId },
    include: {
      completions: {
        where: { date: { gte: from ?? defaultFromDate() } },
        orderBy: { date: "asc" },
        select: { date: true },
      },
    },
  } );

/**
 * GET /api/routines?from=YYYY-MM-DD
 * Lists the user's routines with completion dates since `from` (default ~4 months).
 */
export const listRoutines = async ( req, res, next ) =>
{
  try
  {
    const from = req.query.from
      ? parseDateKey( String( req.query.from ), "from" )
      : defaultFromDate();

    const routines = await prisma.routine.findMany( {
      where: { userId: req.user.id },
      orderBy: [ { timeOfDay: { sort: "asc", nulls: "last" } }, { createdAt: "asc" } ],
      include: {
        completions: {
          where: { date: { gte: from } },
          orderBy: { date: "asc" },
          select: { date: true },
        },
      },
    } );

    res.status( 200 ).json( {
      success: true,
      data: routines.map( serializeRoutine ),
      message: "Routines fetched successfully",
    } );
  } catch ( error )
  {
    next( error );
  }
};

/** POST /api/routines */
export const createRoutine = async ( req, res, next ) =>
{
  try
  {
    const data = parseRoutineInput( req.body ?? {}, { requireTitle: true } );
    const created = await prisma.routine.create( {
      data: { ...data, userId: req.user.id },
      include: { completions: { select: { date: true } } },
    } );

    broadcastRoutineChange( req.user.id );
    res.status( 201 ).json( {
      success: true,
      data: serializeRoutine( created ),
      message: "Routine created successfully",
    } );
  } catch ( error )
  {
    next( error );
  }
};

/** PATCH /api/routines/:id */
export const updateRoutine = async ( req, res, next ) =>
{
  try
  {
    const id = parseId( req.params.id );
    const existing = await prisma.routine.findFirst( {
      where: { id, userId: req.user.id },
      select: { id: true },
    } );
    if ( !existing ) throw notFound();

    const data = parseRoutineInput( req.body ?? {}, { requireTitle: false } );
    await prisma.routine.update( { where: { id }, data } );

    const updated = await findOwnedRoutine( id, req.user.id );
    broadcastRoutineChange( req.user.id );
    res.status( 200 ).json( {
      success: true,
      data: serializeRoutine( updated ),
      message: "Routine updated successfully",
    } );
  } catch ( error )
  {
    next( error );
  }
};

/** DELETE /api/routines/:id */
export const deleteRoutine = async ( req, res, next ) =>
{
  try
  {
    const id = parseId( req.params.id );
    const { count } = await prisma.routine.deleteMany( {
      where: { id, userId: req.user.id },
    } );
    if ( count === 0 ) throw notFound();

    broadcastRoutineChange( req.user.id );
    res.status( 200 ).json( {
      success: true,
      data: { id },
      message: "Routine deleted successfully",
    } );
  } catch ( error )
  {
    next( error );
  }
};

/** PUT /api/routines/:id/completions/:date — mark done for that day (idempotent). */
export const completeRoutine = async ( req, res, next ) =>
{
  try
  {
    const id = parseId( req.params.id );
    const date = parseDateKey( req.params.date );
    const existing = await prisma.routine.findFirst( {
      where: { id, userId: req.user.id },
      select: { id: true },
    } );
    if ( !existing ) throw notFound();

    await prisma.routineCompletion.upsert( {
      where: { routineId_date: { routineId: id, date } },
      create: { routineId: id, date },
      update: {},
    } );

    broadcastRoutineChange( req.user.id );
    res.status( 200 ).json( {
      success: true,
      data: { routineId: id, date, completed: true },
      message: "Routine checked in",
    } );
  } catch ( error )
  {
    next( error );
  }
};

/** DELETE /api/routines/:id/completions/:date — undo the check-in (idempotent). */
export const uncompleteRoutine = async ( req, res, next ) =>
{
  try
  {
    const id = parseId( req.params.id );
    const date = parseDateKey( req.params.date );
    const existing = await prisma.routine.findFirst( {
      where: { id, userId: req.user.id },
      select: { id: true },
    } );
    if ( !existing ) throw notFound();

    await prisma.routineCompletion.deleteMany( { where: { routineId: id, date } } );

    broadcastRoutineChange( req.user.id );
    res.status( 200 ).json( {
      success: true,
      data: { routineId: id, date, completed: false },
      message: "Routine check-in removed",
    } );
  } catch ( error )
  {
    next( error );
  }
};

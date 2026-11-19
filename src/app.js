import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes.js";
import todoRoutes from "./routes/todo.routes.js";
import routineRoutes from "./routes/routine.routes.js";
import prisma from "./prisma/client.js";

const app = express();

app.use( cors() );
app.use( express.json() );
app.use( express.urlencoded( { extended: true } ) );

// Lightweight uptime/health endpoint for the Render free tier and external
// monitors (UptimeRobot, cron-job.org, ...). Same as financial_management_be:
// - unauthenticated
// - very fast
// - does NOT touch the database (a slow/paused DB must not fail the ping)
app.get( "/health", ( _req, res ) =>
{
  res.status( 200 ).type( "text/plain" ).send( "ok" );
} );

// Optional deeper check that also verifies the database is reachable.
app.get( "/health/db", async ( _req, res ) =>
{
  try
  {
    await prisma.$queryRaw`SELECT 1`;
    res.status( 200 ).type( "text/plain" ).send( "ok" );
  } catch ( error )
  {
    res.status( 503 ).type( "text/plain" ).send( "db unreachable" );
  }
} );

app.use( "/api/auth", authRoutes );
app.use( "/api/todos", todoRoutes );
app.use( "/api/routines", routineRoutes );

app.use( ( req, res, next ) =>
{
  const error = new Error( `Route ${ req.method } ${ req.originalUrl } not found` );
  error.statusCode = 404;
  next( error );
} );

app.use( ( err, req, res, _next ) =>
{
  const statusCode = err.statusCode || 500;
  const response = {
    success: false,
    data: null,
    message: err.message || "Internal server error",
  };

  if ( err.errors )
  {
    response.data = err.errors;
  }

  if ( process.env.NODE_ENV !== "production" && err.stack )
  {
    response.stack = err.stack;
  }

  res.status( statusCode ).json( response );
} );

export default app;

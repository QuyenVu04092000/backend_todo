import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes.js";
import todoRoutes from "./routes/todo.routes.js";
import prisma from "./prisma/client.js";

const app = express();

app.use( cors() );
app.use( express.json() );
app.use( express.urlencoded( { extended: true } ) );

// Health check endpoint used for uptime monitoring (e.g. Render free tier,
// UptimeRobot, or cron-based pings). Includes a lightweight DB ping to ensure
// the database is reachable.
app.get( "/health", async ( _req, res ) =>
{
  try
  {
    // Simple DB connectivity check: SELECT 1
    await prisma.$queryRaw`SELECT 1`;
    res.status( 200 ).type( "text/plain" ).send( "ok" );
  } catch ( error )
  {
    // If the DB is not reachable, return 500 so monitoring can alert.
    res.status( 500 ).type( "text/plain" ).send( "error" );
  }
} );

app.use( "/api/auth", authRoutes );
app.use( "/api/todos", todoRoutes );

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

import dotenv from "dotenv";

import app from "./app.js";
import prisma from "./prisma/client.js";

dotenv.config();

const port = Number( process.env.PORT || 3000 );

const startServer = async () =>
{
  try
  {
    await prisma.$connect();
    app.listen( port, () =>
    {
      console.log( `🚀 Server running on port ${ port }` );
    } );
  } catch ( error )
  {
    console.error( "Failed to start server", error );
    process.exit( 1 );
  }
};

startServer();

const gracefulShutdown = async () =>
{
  try
  {
    await prisma.$disconnect();
  } catch ( error )
  {
    console.error( "Error during disconnection", error );
  } finally
  {
    process.exit( 0 );
  }
};

process.on( "SIGINT", gracefulShutdown );
process.on( "SIGTERM", gracefulShutdown );

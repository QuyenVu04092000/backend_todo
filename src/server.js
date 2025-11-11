import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import app from "./app.js";
import prisma from "./prisma/client.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "./uploads");

fs.mkdirSync(uploadsDir, { recursive: true });

const port = Number(process.env.PORT || 3000);

const startServer = async () => {
  try {
    await prisma.$connect();
    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
};

startServer();

const gracefulShutdown = async () => {
  try {
    await prisma.$disconnect();
  } catch (error) {
    console.error("Error during disconnection", error);
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

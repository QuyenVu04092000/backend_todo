import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadPath = path.resolve(__dirname, "../uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!file.mimetype.startsWith("image/")) {
    const error = new Error("Only image files are allowed");
    error.statusCode = 400;
    return cb(error);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

export default upload;

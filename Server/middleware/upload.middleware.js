import multer from "multer";
import { UPLOAD_DIR } from "../config/paths.js";

export const upload = multer({
    dest: UPLOAD_DIR,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

import { Router } from "express";
import { upload } from "../middleware/upload.middleware.js";
import {
    configInterview, hello, introStart, nextQuestion, resetInterview, interviewerReply
} from "../controllers/interview.controller.js";

const r = Router();
r.post("/config", configInterview);
r.get("/hello", hello);
r.post("/introStart", introStart);
r.post("/next", nextQuestion);
r.post("/reset", resetInterview);
r.post("/reply", upload.single("audio"), interviewerReply); // audio OR text

export default r;

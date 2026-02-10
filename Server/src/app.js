import express from "express";
import cors from "cors";
import resumeRoutes from "../routes/resume.routes.js";
import interviewRoutes from "../routes/interview.routes.js";
import ttsRoutes from "../routes/tts.routes.js";
import sttRoutes from "../routes/stt.routes.js";
import replyRoutes from "../routes/reply.routes.js";
import agentRoutes from "../routes/agent.routes.js";
import http from "http";
import { attachAgentProxy } from "../ws/agentProxy.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.use("/api/resume", resumeRoutes);
app.use("/api/interview", interviewRoutes);
app.use("/api/tts", ttsRoutes);
app.use("/api/stt", sttRoutes);
app.use("/api/reply", replyRoutes);

app.use("/api/agent", agentRoutes);

const server = http.createServer(app);
attachAgentProxy(server);



app.get("/", (_req, res) => res.send("OK"));

export default app;           // 👈 IMPORTANT: default export

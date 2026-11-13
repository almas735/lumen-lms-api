import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import authRouter from "./routes/auth";
import courseRouter from "./routes/courses";
import adminRouter from "./routes/admin";
import contentRouter from "./routes/content";
import progressRouter from "./routes/progress";
import quizRouter from "./routes/quiz";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api", courseRouter);
app.use("/api/admin", adminRouter);
app.use("/api", contentRouter);
app.use("/api", progressRouter);
app.use("/api", quizRouter);

app.use(errorHandler);

export default app;

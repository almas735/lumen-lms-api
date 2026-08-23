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

dotenv.config();

const app = express();

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

app.use(errorHandler);

export default app;

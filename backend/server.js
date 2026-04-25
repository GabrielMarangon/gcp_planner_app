import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import plannerRouter from "./src/routes/planner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistPath = path.resolve(__dirname, "../frontend/dist");
const frontendIndexPath = path.join(frontendDistPath, "index.html");

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const hasFrontendBuild = fs.existsSync(frontendIndexPath);

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "gcp-planner-backend" });
});

app.use("/api", plannerRouter);

if (hasFrontendBuild) {
  app.use(express.static(frontendDistPath));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health") {
      next();
      return;
    }

    res.sendFile(frontendIndexPath);
  });
}

app.listen(port, host, () => {
  const visibleHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`GCP Planner backend running on http://${visibleHost}:${port}`);
  if (hasFrontendBuild) {
    console.log(`Serving frontend build from ${frontendDistPath}`);
  }
});

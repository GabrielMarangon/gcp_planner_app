import express from "express";
import cors from "cors";
import plannerRouter from "./src/routes/planner.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "gcp-planner-backend" });
});

app.use("/api", plannerRouter);

app.listen(port, host, () => {
  const visibleHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`GCP Planner backend running on http://${visibleHost}:${port}`);
});

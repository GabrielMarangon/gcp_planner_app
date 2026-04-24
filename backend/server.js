import express from "express";
import cors from "cors";
import plannerRouter from "./src/routes/planner.js";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "gcp-planner-backend" });
});

app.use("/api", plannerRouter);

app.listen(port, () => {
  console.log(`GCP Planner backend running on http://localhost:${port}`);
});

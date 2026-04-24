import { Router } from "express";
import { buildPlan } from "../services/plannerEngine.js";
import { exportCsv, exportGeoJson, exportKml } from "../services/exporters.js";

const router = Router();

router.post("/plan", (req, res) => {
  try {
    const result = buildPlan(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || "Nao foi possivel gerar o plano." });
  }
});

router.post("/export/:format", (req, res) => {
  try {
    const { format } = req.params;
    const { points = [] } = req.body || {};

    if (!Array.isArray(points) || points.length === 0) {
      throw new Error("Nenhum ponto foi informado para exportacao.");
    }

    if (format === "csv") {
      const csv = exportCsv(points);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=gcp_planner_points.csv");
      return res.send(csv);
    }

    if (format === "geojson") {
      const geojson = exportGeoJson(points);
      res.setHeader("Content-Type", "application/geo+json; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=gcp_planner_points.geojson");
      return res.send(JSON.stringify(geojson, null, 2));
    }

    if (format === "kml") {
      const kml = exportKml(points);
      res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=gcp_planner_points.kml");
      return res.send(kml);
    }

    throw new Error("Formato de exportacao invalido.");
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha na exportacao." });
  }
});

export default router;

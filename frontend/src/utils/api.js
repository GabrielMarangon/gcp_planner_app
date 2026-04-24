const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export async function requestPlan(payload) {
  const response = await fetch(`${API_BASE}/api/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Falha ao gerar o plano de pontos.");
  }

  return data;
}

export async function exportPlanFile(format, payload) {
  const response = await fetch(`${API_BASE}/api/export/${format}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Falha na exportacao.");
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const fallbackName = `gcp_planner_points.${format === "geojson" ? "geojson" : format}`;
  const filenameMatch = disposition.match(/filename=([^;]+)/i);
  const filename = filenameMatch ? filenameMatch[1].replaceAll("\"", "") : fallbackName;

  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? "http://localhost:3000" : "")
).replace(/\/+$/, "");
const REQUEST_RETRY_LIMIT = 3;
const WARMUP_RETRY_LIMIT = 8;
const WARMUP_DELAY_MS = 5000;
const NETWORK_ERROR_MESSAGE =
  "Nao foi possivel conectar ao servidor. No plano free do Render, o backend pode levar alguns segundos para acordar. Aguarde um pouco e tente novamente.";

export async function requestPlan(payload) {
  try {
    return await requestJson("/api/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw normalizeRequestError(error, "Falha ao gerar o plano de pontos.");
  }
}

export async function exportPlanFile(format, payload) {
  try {
    const response = await requestWithRetry(`/api/export/${format}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await parseJsonSafely(response);
      throw new Error(errorData?.error || "Falha na exportacao.");
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
  } catch (error) {
    throw normalizeRequestError(error, "Falha na exportacao.");
  }
}

async function requestJson(path, options) {
  const response = await requestWithRetry(path, options);
  const data = await parseJsonSafely(response);

  if (!response.ok) {
    throw new Error(data?.error || "Falha na requisicao.");
  }

  return data;
}

async function requestWithRetry(path, options) {
  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= REQUEST_RETRY_LIMIT; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        cache: "no-store"
      });

      if (!shouldRetryResponse(response) || attempt === REQUEST_RETRY_LIMIT) {
        return response;
      }

      lastResponse = response;
      await warmupApi();
    } catch (error) {
      lastError = error;

      if (!shouldRetryRequest(error) || attempt === REQUEST_RETRY_LIMIT) {
        break;
      }

      await warmupApi();
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError || new Error(NETWORK_ERROR_MESSAGE);
}

async function warmupApi() {
  for (let attempt = 1; attempt <= WARMUP_RETRY_LIMIT; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}/health`, {
        method: "GET",
        cache: "no-store"
      });

      if (response.ok) {
        return;
      }
    } catch {
      // The service is likely still waking up.
    }

    if (attempt < WARMUP_RETRY_LIMIT) {
      await wait(WARMUP_DELAY_MS);
    }
  }
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function shouldRetryRequest(error) {
  if (!error) {
    return false;
  }

  return error instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(error.message);
}

function shouldRetryResponse(response) {
  if (!response) {
    return false;
  }

  return response.status === 502 || response.status === 503 || response.status === 504;
}

function normalizeRequestError(error, fallbackMessage) {
  if (shouldRetryRequest(error)) {
    return new Error(NETWORK_ERROR_MESSAGE);
  }

  return error instanceof Error ? error : new Error(fallbackMessage);
}

function wait(durationMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

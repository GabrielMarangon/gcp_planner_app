import { useEffect, useMemo, useRef, useState } from "react";
import MapPanel from "./components/MapPanel.jsx";
import ControlPanel from "./components/ControlPanel.jsx";
import { calculateAreaStats, enrichPoints } from "./utils/coordinates.js";
import { exportPlanFile, requestPlan } from "./utils/api.js";

const DEFAULT_PARAMS = {
  flightHeight: 80,
  terrain: "plano",
  precision: "media",
  checkpointPercent: 20
};

const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 60000
};

const GEOLOCATION_FALLBACK_OPTIONS = {
  enableHighAccuracy: false,
  timeout: 20000,
  maximumAge: 300000
};

export default function App() {
  const [polygon, setPolygon] = useState(null);
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [points, setPoints] = useState([]);
  const [summary, setSummary] = useState(null);
  const [messages, setMessages] = useState([]);
  const [references, setReferences] = useState([]);
  const [exportFormat, setExportFormat] = useState("csv");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("idle");
  const [locationError, setLocationError] = useState("");
  const [pointEditorEnabled, setPointEditorEnabled] = useState(false);
  const [mapFocusState, setMapFocusState] = useState({ target: "location", revision: 0 });
  const hasRequestedLocationRef = useRef(false);
  const locationRequestIdRef = useRef(0);

  const areaStats = useMemo(() => calculateAreaStats(polygon), [polygon]);
  const displaySummary = useMemo(() => {
    if (!summary) {
      return null;
    }

    const gcpCount = points.filter((point) => point.type === "GCP").length;
    const checkpointCount = points.filter((point) => point.type === "CHECKPOINT").length;
    const totalReferencePoints = points.length;
    const effectiveCheckpointPercent =
      totalReferencePoints > 0
        ? Number(((checkpointCount / totalReferencePoints) * 100).toFixed(1))
        : 0;

    return {
      ...summary,
      gcpCount,
      checkpointCount,
      totalReferencePoints,
      effectiveCheckpointPercent,
      densityPerSqKm: Number(
        (totalReferencePoints / Math.max(summary.areaSqKm, 0.01)).toFixed(2)
      ),
      breakdown: summary.breakdown
        ? {
            ...summary.breakdown,
            effectiveCheckpointPercent
          }
        : summary.breakdown
    };
  }, [points, summary]);

  useEffect(() => {
    if (hasRequestedLocationRef.current) {
      return;
    }

    hasRequestedLocationRef.current = true;
    requestUserLocation();
  }, []);

  useEffect(() => {
    if (!points.length) {
      setPointEditorEnabled(false);
    }
  }, [points.length]);

  useEffect(() => {
    if (userLocation && !polygon && points.length === 0) {
      queueMapFocus("location");
    }
  }, [polygon, points.length, userLocation]);

  function handlePolygonChange(nextPolygon) {
    setPolygon(nextPolygon);
    setPoints([]);
    setSummary(null);
    setMessages([]);
    setReferences([]);
    setError("");
    setPointEditorEnabled(false);
    queueMapFocus(nextPolygon ? "polygon" : "location");
  }

  async function handleGeneratePoints() {
    if (!polygon) {
      setError("Desenhe uma \u00e1rea no mapa antes de gerar os pontos.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await requestPlan({ polygon, params });
      setPoints(normalizeGeneratedPoints(response.points));
      setSummary(response.summary);
      setMessages(response.explanation || []);
      setReferences(response.references || []);
      setPointEditorEnabled(false);
      queueMapFocus("points");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  function handleClearArea() {
    handlePolygonChange(null);
    setParams(DEFAULT_PARAMS);
  }

  function handlePointsChange(nextPoints) {
    setPoints(normalizeGeneratedPoints(nextPoints));
  }

  function handleRemovePoint(pointId) {
    setPoints((currentPoints) =>
      normalizeGeneratedPoints(currentPoints.filter((point) => point.id !== pointId))
    );
  }

  function handlePointTypeChange(pointId, nextType) {
    setPoints((currentPoints) =>
      normalizeGeneratedPoints(
        currentPoints.map((point) =>
          point.id === pointId
            ? {
                ...point,
                type: nextType
              }
            : point
        )
      )
    );
  }

  function handleTogglePointEditor() {
    if (!points.length) {
      return;
    }

    const nextValue = !pointEditorEnabled;
    setPointEditorEnabled(nextValue);
    if (nextValue) {
      queueMapFocus("points");
    }
  }

  function queueMapFocus(target) {
    setMapFocusState((currentState) => ({
      target,
      revision: currentState.revision + 1
    }));
  }

  async function requestUserLocation() {
    if (typeof window === "undefined" || !window.navigator?.geolocation) {
      setLocationStatus("unsupported");
      setLocationError("Geolocaliza\u00e7\u00e3o indispon\u00edvel neste navegador.");
      return;
    }

    const requestId = locationRequestIdRef.current + 1;
    locationRequestIdRef.current = requestId;
    setLocationStatus("loading");
    setLocationError("");

    try {
      const position = await getBrowserPosition(window.navigator.geolocation, GEOLOCATION_OPTIONS);
      commitUserLocation(position, requestId);
    } catch (geoError) {
      if (geoError?.code === 3 || geoError?.code === 2) {
        try {
          const fallbackPosition = await getBrowserPosition(
            window.navigator.geolocation,
            GEOLOCATION_FALLBACK_OPTIONS
          );
          commitUserLocation(fallbackPosition, requestId);
          return;
        } catch (fallbackError) {
          commitLocationError(fallbackError, requestId);
          return;
        }
      }

      commitLocationError(geoError, requestId);
    }
  }

  function commitUserLocation(position, requestId) {
    if (locationRequestIdRef.current !== requestId) {
      return;
    }

    const { latitude, longitude, accuracy } = position.coords;
    setUserLocation({
      lat: latitude,
      lng: longitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      timestamp: position.timestamp || Date.now()
    });
    setLocationStatus("ready");
  }

  function commitLocationError(geoError, requestId) {
    if (locationRequestIdRef.current !== requestId) {
      return;
    }

    setLocationStatus("error");
    setLocationError(getGeolocationErrorMessage(geoError));
  }

  async function handleExport() {
    if (!points.length) {
      setError("Gere os pontos antes de exportar.");
      return;
    }

    try {
      await exportPlanFile(exportFormat, {
        points,
        polygon,
        params,
        summary: displaySummary
      });
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="app-shell">
      <ControlPanel
        areaStats={areaStats}
        params={params}
        onParamsChange={setParams}
        onGeneratePoints={handleGeneratePoints}
        onExport={handleExport}
        onClearArea={handleClearArea}
        onTogglePointEditor={handleTogglePointEditor}
        exportFormat={exportFormat}
        onExportFormatChange={setExportFormat}
        summary={displaySummary}
        messages={messages}
        references={references}
        points={points}
        onRemovePoint={handleRemovePoint}
        onPointTypeChange={handlePointTypeChange}
        pointEditorEnabled={pointEditorEnabled}
        loading={loading}
        error={error}
        userLocation={userLocation}
        locationStatus={locationStatus}
        locationError={locationError}
        onRequestLocation={requestUserLocation}
      />

      <main className="map-stage">
        <div className="map-stage__sticky">
          <MapPanel
            polygon={polygon}
            onPolygonChange={handlePolygonChange}
            points={points}
            onPointsChange={handlePointsChange}
            onPointTypeChange={handlePointTypeChange}
            onRemovePoint={handleRemovePoint}
            userLocation={userLocation}
            pointEditorEnabled={pointEditorEnabled}
            mapFocusState={mapFocusState}
          />
        </div>
      </main>
    </div>
  );
}

function getGeolocationErrorMessage(error) {
  if (!error) {
    return "N\u00e3o foi poss\u00edvel identificar a localiza\u00e7\u00e3o atual.";
  }

  if (error.code === 1) {
    return "Permiss\u00e3o de localiza\u00e7\u00e3o negada. Libere o acesso no navegador para centralizar o mapa.";
  }

  if (error.code === 2) {
    return "N\u00e3o foi poss\u00edvel determinar a localiza\u00e7\u00e3o atual do dispositivo.";
  }

  if (error.code === 3) {
    return "A localiza\u00e7\u00e3o demorou demais para responder. Tente atualizar novamente.";
  }

  return error.message || "N\u00e3o foi poss\u00edvel identificar a localiza\u00e7\u00e3o atual.";
}

function getBrowserPosition(geolocation, options) {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function normalizeGeneratedPoints(points) {
  return relabelPointsByType(enrichPoints(points));
}

function relabelPointsByType(points) {
  let gcpIndex = 0;
  let checkpointIndex = 0;

  return points.map((point) => {
    const nextType = point.type === "CHECKPOINT" ? "CHECKPOINT" : "GCP";

    if (nextType === "GCP") {
      gcpIndex += 1;
      return {
        ...point,
        type: nextType,
        label: `GCP ${gcpIndex}`
      };
    }

    checkpointIndex += 1;
    return {
      ...point,
      type: nextType,
      label: `Checkpoint ${checkpointIndex}`
    };
  });
}

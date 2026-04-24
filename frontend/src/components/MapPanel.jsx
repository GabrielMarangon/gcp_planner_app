import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  Circle,
  CircleMarker,
  LayersControl,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  ScaleControl,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents
} from "react-leaflet";
import { formatLatLng, formatUtm } from "../utils/coordinates.js";

const DEFAULT_CENTER = [-15.77972, -47.92972];
const USER_LOCATION_CIRCLE_STYLE = {
  color: "#0f6d7e",
  fillColor: "#0f6d7e",
  fillOpacity: 0.08,
  weight: 1
};
const USER_LOCATION_MARKER_STYLE = {
  color: "#ffffff",
  fillColor: "#0f6d7e",
  fillOpacity: 1,
  weight: 3
};
const PROJECT_POLYGON_STYLE = {
  color: "#0f6d7e",
  weight: 3,
  fillColor: "#0f6d7e",
  fillOpacity: 0.12
};
const DRAWING_POLYGON_STYLE = {
  color: "#1f3b59",
  weight: 3,
  fillColor: "#3e6d95",
  fillOpacity: 0.16,
  dashArray: "6 4"
};
const DRAWING_LINE_STYLE = {
  color: "#1f3b59",
  weight: 3,
  dashArray: "6 4"
};
const DRAFT_VERTEX_STYLE = {
  color: "#ffffff",
  fillColor: "#1f3b59",
  fillOpacity: 1,
  weight: 2
};

export default function MapPanel({
  polygon,
  onPolygonChange,
  points,
  onPointsChange,
  onPointTypeChange,
  onRemovePoint,
  userLocation,
  pointEditorEnabled,
  mapFocusState
}) {
  const [mode, setMode] = useState("view");
  const [workingVertices, setWorkingVertices] = useState(() => polygonToLatLngs(polygon));
  const ignoreNextMapClickRef = useRef(false);
  const toolsRef = useRef(null);
  const icons = useMemo(() => {
    return {
      GCP: createPointIcon("G", "point-icon--gcp"),
      CHECKPOINT: createPointIcon("C", "point-icon--checkpoint"),
      vertex: createHandleIcon("", "map-handle map-handle--vertex"),
      insert: createHandleIcon("+", "map-handle map-handle--insert")
    };
  }, []);

  useEffect(() => {
    if (!polygon) {
      if (mode === "view" || mode === "editing") {
        setWorkingVertices([]);
      }
      if (mode === "editing") {
        setMode("view");
      }
      return;
    }

    if (mode === "view") {
      setWorkingVertices(polygonToLatLngs(polygon));
    }
  }, [mode, polygon]);

  const committedVertices = polygonToLatLngs(polygon);
  const activeVertices = mode === "view" ? committedVertices : workingVertices;
  const visiblePoints = mode === "view" ? points : [];
  const midpointHandles = mode === "editing" ? buildMidpointHandles(workingVertices) : [];
  const hint =
    mode === "drawing"
      ? "Clique no mapa para adicionar quantos vértices quiser e use Concluir quando terminar."
      : mode === "editing"
        ? "Arraste os vértices azuis. Clique nos marcadores + para inserir novos vértices."
        : polygon
          ? "Use Editar vértices para ajustar o polígono atual ou Novo polígono para redesenhar."
          : "Use Desenhar polígono e clique no mapa para iniciar a área do projeto.";

  function handleDragEnd(pointId, event) {
    const { lat, lng } = event.target.getLatLng();
    onPointsChange(
      points.map((point) =>
        point.id === pointId
          ? {
              ...point,
              coordinates: [lng, lat]
            }
          : point
      )
    );
  }

  function startDrawing() {
    setWorkingVertices([]);
    setMode("drawing");
    if (polygon) {
      onPolygonChange(null);
    }
  }

  function cancelDrawing() {
    setWorkingVertices([]);
    setMode("view");
  }

  function finishDrawing() {
    if (workingVertices.length < 3) {
      return;
    }

    ignoreNextMapClickRef.current = true;
    onPolygonChange(buildPolygonFeature(workingVertices));
    setMode("view");
  }

  function undoLastDraftVertex() {
    setWorkingVertices((currentVertices) => currentVertices.slice(0, -1));
  }

  function startEditing() {
    if (!polygon) {
      return;
    }

    setWorkingVertices(polygonToLatLngs(polygon));
    setMode("editing");
  }

  function cancelEditing() {
    setWorkingVertices(committedVertices);
    setMode("view");
  }

  function finishEditing() {
    if (workingVertices.length < 3) {
      return;
    }

    onPolygonChange(buildPolygonFeature(workingVertices));
    setMode("view");
  }

  function addDraftVertex(latlng) {
    setWorkingVertices((currentVertices) => [...currentVertices, [latlng.lat, latlng.lng]]);
  }

  function updateVertex(index, latlng) {
    setWorkingVertices((currentVertices) =>
      currentVertices.map((vertex, vertexIndex) =>
        vertexIndex === index ? [latlng.lat, latlng.lng] : vertex
      )
    );
  }

  function insertVertex(afterIndex) {
    setWorkingVertices((currentVertices) => insertMidpointVertex(currentVertices, afterIndex));
  }

  function removeVertex(index) {
    setWorkingVertices((currentVertices) => {
      if (currentVertices.length <= 3) {
        return currentVertices;
      }

      return currentVertices.filter((_vertex, vertexIndex) => vertexIndex !== index);
    });
  }

  return (
    <MapContainer
      center={userLocation ? [userLocation.lat, userLocation.lng] : DEFAULT_CENTER}
      zoom={userLocation ? 15 : 5}
      className="map-root"
      scrollWheelZoom={true}
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="OpenStreetMap">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </LayersControl.BaseLayer>

        <LayersControl.BaseLayer name="ESRI Satelite">
          <TileLayer
            attribution="Tiles &copy; Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      <ScaleControl position="bottomleft" />

      <MapSizeController />
      <MapInteractionController
        mode={mode}
        onAddVertex={addDraftVertex}
        ignoreNextMapClickRef={ignoreNextMapClickRef}
      />
      <UserLocationController userLocation={userLocation} polygon={polygon} points={points} />
      <FitToGeometry
        polygon={polygon}
        points={visiblePoints}
        enabled={mode === "view"}
        focusState={mapFocusState}
        userLocation={userLocation}
      />

      <MapTools
        toolsRef={toolsRef}
        mode={mode}
        polygon={polygon}
        draftVertexCount={workingVertices.length}
        hint={hint}
        onArmMapClickGuard={() => {
          ignoreNextMapClickRef.current = true;
        }}
        onStartDrawing={startDrawing}
        onCancelDrawing={cancelDrawing}
        onFinishDrawing={finishDrawing}
        onUndoDraftVertex={undoLastDraftVertex}
        onStartEditing={startEditing}
        onCancelEditing={cancelEditing}
        onFinishEditing={finishEditing}
      />

      {userLocation ? (
        <>
          {Number.isFinite(userLocation.accuracy) ? (
            <Circle
              center={[userLocation.lat, userLocation.lng]}
              radius={Math.max(12, Math.round(userLocation.accuracy))}
              pathOptions={USER_LOCATION_CIRCLE_STYLE}
            />
          ) : null}
          <CircleMarker
            center={[userLocation.lat, userLocation.lng]}
            radius={8}
            pathOptions={USER_LOCATION_MARKER_STYLE}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
              Sua localização
            </Tooltip>
          </CircleMarker>
        </>
      ) : null}

      {mode !== "view" && activeVertices.length > 0 ? (
        <>
          {activeVertices.length >= 3 ? (
            <Polygon positions={activeVertices} pathOptions={DRAWING_POLYGON_STYLE} />
          ) : (
            <Polyline positions={activeVertices} pathOptions={DRAWING_LINE_STYLE} />
          )}

          {mode === "drawing"
            ? activeVertices.map((vertex, index) => (
                <CircleMarker
                  key={`draft-vertex-${index}`}
                  center={vertex}
                  radius={5}
                  pathOptions={DRAFT_VERTEX_STYLE}
                >
                  <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                    Vértice {index + 1}
                  </Tooltip>
                </CircleMarker>
              ))
            : null}

          {mode === "editing"
            ? activeVertices.map((vertex, index) => (
                <Marker
                  key={`edit-vertex-${index}`}
                  position={vertex}
                  icon={icons.vertex}
                  draggable={true}
                  eventHandlers={{
                    drag: (event) => updateVertex(index, event.target.getLatLng()),
                    dragend: (event) => updateVertex(index, event.target.getLatLng())
                  }}
                >
                  <Tooltip direction="top" offset={[0, -12]} opacity={0.9}>
                    Vértice {index + 1}
                  </Tooltip>
                  <Popup>
                    <div className="popup-content">
                      <strong>Vértice {index + 1}</strong>
                      <p>{formatLatLng(vertex[0], vertex[1])}</p>
                      <button
                        className="ghost-button ghost-button--popup"
                        type="button"
                        onClick={() => removeVertex(index)}
                        disabled={activeVertices.length <= 3}
                      >
                        Remover vértice
                      </button>
                    </div>
                  </Popup>
                </Marker>
              ))
            : null}

          {mode === "editing"
            ? midpointHandles.map((handle) => (
                <Marker
                  key={handle.key}
                  position={handle.position}
                  icon={icons.insert}
                  eventHandlers={{
                    click: () => insertVertex(handle.afterIndex)
                  }}
                >
                  <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                    Inserir vértice
                  </Tooltip>
                </Marker>
              ))
            : null}
        </>
      ) : null}

      {mode === "view" && committedVertices.length >= 3 ? (
        <Polygon positions={committedVertices} pathOptions={PROJECT_POLYGON_STYLE} />
      ) : null}

      {visiblePoints.map((point) => (
        <Marker
          key={point.id}
          position={[point.lat, point.lng]}
          icon={icons[point.type]}
          draggable={pointEditorEnabled}
          eventHandlers={{
            dragend: (event) => handleDragEnd(point.id, event)
          }}
        >
          <Tooltip direction="top" offset={[0, -12]} opacity={0.9}>
            {point.label}
          </Tooltip>
          <Popup>
            <div className="popup-content">
              <strong>{point.label}</strong>
              <p>{formatLatLng(point.lat, point.lng)}</p>
              <p>{formatUtm(point.utm)}</p>
              {pointEditorEnabled ? (
                <button
                  className="ghost-button ghost-button--popup"
                  type="button"
                  onClick={() =>
                    onPointTypeChange(point.id, point.type === "GCP" ? "CHECKPOINT" : "GCP")
                  }
                >
                  {point.type === "GCP" ? "Transformar em checkpoint" : "Transformar em controle"}
                </button>
              ) : null}
              <button
                className="ghost-button ghost-button--popup"
                type="button"
                onClick={() => onRemovePoint(point.id)}
              >
                Remover ponto
              </button>
            </div>
          </Popup>
        </Marker>
      ))}

      <div className="map-legend">
        <div>
          <span className="legend-swatch legend-swatch--gcp"></span>
          <strong>GCP</strong>
        </div>
        <div>
          <span className="legend-swatch legend-swatch--checkpoint"></span>
          <strong>Checkpoint</strong>
        </div>
      </div>
    </MapContainer>
  );
}

function MapInteractionController({ mode, onAddVertex, ignoreNextMapClickRef }) {
  const map = useMapEvents({
    click(event) {
      if (ignoreNextMapClickRef.current) {
        ignoreNextMapClickRef.current = false;
        return;
      }

      if (mode === "drawing") {
        onAddVertex(event.latlng);
      }
    }
  });

  useEffect(() => {
    if (mode === "drawing") {
      map.doubleClickZoom.disable();
      return;
    }

    map.doubleClickZoom.enable();
  }, [map, mode]);

  useEffect(() => {
    return () => {
      map.doubleClickZoom.enable();
    };
  }, [map]);

  return null;
}

function MapSizeController() {
  const map = useMap();

  useEffect(() => {
    const refreshSize = () => map.invalidateSize();

    refreshSize();
    window.addEventListener("resize", refreshSize);

    return () => {
      window.removeEventListener("resize", refreshSize);
    };
  }, [map]);

  return null;
}

function MapTools(props) {
  const {
    toolsRef,
    mode,
    polygon,
    draftVertexCount,
    hint,
    onArmMapClickGuard,
    onStartDrawing,
    onCancelDrawing,
    onFinishDrawing,
    onUndoDraftVertex,
    onStartEditing,
    onCancelEditing,
    onFinishEditing
  } = props;

  useEffect(() => {
    const container = toolsRef?.current;
    if (!container) {
      return;
    }

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const stopNativePropagation = (event) => {
      event.stopPropagation();
    };

    container.addEventListener("pointerdown", stopNativePropagation);
    container.addEventListener("pointerup", stopNativePropagation);

    return () => {
      container.removeEventListener("pointerdown", stopNativePropagation);
      container.removeEventListener("pointerup", stopNativePropagation);
    };
  }, [toolsRef]);

  return (
    <div
      ref={toolsRef}
      className="map-tools"
      onClick={stopMapEventPropagation}
      onDoubleClick={stopMapEventPropagation}
      onMouseDown={stopMapEventPropagation}
      onPointerDown={stopMapEventPropagation}
      onWheel={stopMapEventPropagation}
    >
      <div className="map-tools__row">
        {mode === "view" ? (
          <>
            <ToolbarButton
              title={polygon ? "Novo polígono" : "Desenhar polígono"}
              variant="primary"
              icon="polygon"
              onArmMapClickGuard={onArmMapClickGuard}
              onClick={onStartDrawing}
            />
            <ToolbarButton
              title="Editar vértices"
              icon="vertices"
              onArmMapClickGuard={onArmMapClickGuard}
              onClick={onStartEditing}
              disabled={!polygon}
            />
          </>
        ) : null}

        {mode === "drawing" ? (
          <>
            <ToolbarButton
              title="Concluir polígono"
              variant="primary"
              icon="confirm"
              onArmMapClickGuard={onArmMapClickGuard}
              onClick={onFinishDrawing}
              disabled={draftVertexCount < 3}
            />
            <ToolbarButton
              title="Desfazer último vértice"
              icon="undo"
              onArmMapClickGuard={onArmMapClickGuard}
              onClick={onUndoDraftVertex}
              disabled={draftVertexCount === 0}
            />
            <ToolbarButton
              title="Cancelar desenho"
              icon="close"
              onArmMapClickGuard={onArmMapClickGuard}
              onClick={onCancelDrawing}
            />
          </>
        ) : null}

        {mode === "editing" ? (
          <>
            <ToolbarButton
              title="Salvar vértices"
              variant="primary"
              icon="confirm"
              onArmMapClickGuard={onArmMapClickGuard}
              onClick={onFinishEditing}
            />
            <ToolbarButton
              title="Cancelar edição"
              icon="close"
              onArmMapClickGuard={onArmMapClickGuard}
              onClick={onCancelEditing}
            />
          </>
        ) : null}
      </div>

      {mode !== "view" ? <p className="map-tools__hint">{hint}</p> : null}
    </div>
  );
}

function UserLocationController({ userLocation, polygon, points }) {
  const map = useMap();

  useEffect(() => {
    if (!userLocation || polygon || points.length > 0) {
      return;
    }

    map.setView([userLocation.lat, userLocation.lng], 16, {
      animate: true
    });
  }, [map, userLocation, polygon, points]);

  return null;
}

function ToolbarButton({ title, icon, variant = "ghost", disabled = false, onArmMapClickGuard, onClick }) {
  return (
    <button
      className={variant === "primary" ? "primary-button map-tool-icon-button" : "ghost-button map-tool-icon-button"}
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(event) => {
        onArmMapClickGuard?.();
        stopMapEventPropagation(event);
      }}
      onPointerDown={(event) => {
        onArmMapClickGuard?.();
        stopMapEventPropagation(event);
      }}
      onClick={onClick}
      disabled={disabled}
    >
      <MapToolIcon icon={icon} />
    </button>
  );
}

function stopMapEventPropagation(event) {
  event.stopPropagation();
}

function MapToolIcon({ icon }) {
  if (icon === "polygon") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 6l6-2 7 4 1 8-6 4-8-3-1-7 1-4zM5 6l8 14M11 4l2 16M18 8L5 10" />
      </svg>
    );
  }

  if (icon === "vertices") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6h.01M18 6h.01M12 18h.01M7 6l10 0M6 7l6 10M18 7l-6 10" />
      </svg>
    );
  }

  if (icon === "confirm") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12l4 4L19 6" />
      </svg>
    );
  }

  if (icon === "undo") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 8L5 12l4 4M6 12h7a5 5 0 110 10" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function FitToGeometry({ polygon, points, enabled, focusState, userLocation }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !focusState) {
      return;
    }

    if (focusState.target === "points" && points.length > 0) {
      const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]));
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.25));
        return;
      }
    }

    if (focusState.target === "polygon" && polygon) {
      const bounds = L.geoJSON(polygon).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.2));
        return;
      }
    }

    if (focusState.target === "location" && userLocation && !polygon && points.length === 0) {
      map.setView([userLocation.lat, userLocation.lng], 16, {
        animate: true
      });
    }
  }, [enabled, focusState, map, userLocation]);

  return null;
}

function createPointIcon(label, className) {
  return L.divIcon({
    className: `point-icon ${className}`,
    html: `<span>${label}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

function createHandleIcon(label, className) {
  return L.divIcon({
    className,
    html: `<span>${label}</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function polygonToLatLngs(polygon) {
  const ring = polygon?.geometry?.coordinates?.[0];
  if (!ring || ring.length === 0) {
    return [];
  }

  const normalizedRing =
    ring.length > 1 && areCoordinatesEqual(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;

  return normalizedRing.map(([lng, lat]) => [lat, lng]);
}

function buildPolygonFeature(vertices) {
  if (vertices.length < 3) {
    return null;
  }

  const ring = vertices.map(([lat, lng]) => [lng, lat]);

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[...ring, ring[0]]]
    }
  };
}

function buildMidpointHandles(vertices) {
  if (vertices.length < 2) {
    return [];
  }

  return vertices.map((vertex, index) => {
    const nextVertex = vertices[(index + 1) % vertices.length];
    return {
      key: `midpoint-${index}`,
      afterIndex: index,
      position: [(vertex[0] + nextVertex[0]) / 2, (vertex[1] + nextVertex[1]) / 2]
    };
  });
}

function insertMidpointVertex(vertices, afterIndex) {
  if (vertices.length < 2) {
    return vertices;
  }

  const currentVertex = vertices[afterIndex];
  const nextVertex = vertices[(afterIndex + 1) % vertices.length];
  const midpoint = [(currentVertex[0] + nextVertex[0]) / 2, (currentVertex[1] + nextVertex[1]) / 2];
  const nextVertices = [...vertices];

  nextVertices.splice(afterIndex + 1, 0, midpoint);
  return nextVertices;
}

function areCoordinatesEqual(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

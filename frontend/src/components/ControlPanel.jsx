import { useMemo, useState } from "react";
import {
  formatArea,
  formatDensityPerSquareKilometer,
  formatHectares,
  formatLatLng,
  formatSquareKilometers,
  formatUtm
} from "../utils/coordinates.js";

const BASE_REFERENCES = [
  "Cho et al. (2026): GCPs no perimetro e no interior para cenarios exigentes.",
  "Sanz-Ablanedo et al. (2018): distribuicao uniforme e checkpoints independentes.",
  "Oliveira et al. (2024) e MTGIR/INCRA: considerar GSD, area, geometria, relevo e RMS."
];

export default function ControlPanel(props) {
  const {
    areaStats,
    params,
    onParamsChange,
    onGeneratePoints,
    onExport,
    onClearArea,
    onTogglePointEditor,
    exportFormat,
    onExportFormatChange,
    summary,
    messages,
    references,
    points,
    onRemovePoint,
    onPointTypeChange,
    pointEditorEnabled,
    pointPlacementType,
    onStartPointPlacement,
    onCancelPointPlacement,
    loading,
    error,
    userLocation,
    locationStatus,
    locationError,
    onRequestLocation
  } = props;

  const [activeInfoPanel, setActiveInfoPanel] = useState("");

  const infoPanels = useMemo(() => {
    return {
      guide: {
        label: "Guia",
        title: "Guia Rapido",
        items: [
          "Use Desenhar poligono para criar a area do projeto no mapa.",
          "Use Editar vertices para ajustar a geometria e inserir novos vertices depois.",
          "Use Editar pontos para reposicionar, remover, trocar tipos e inserir pontos manualmente direto no mapa."
        ],
        references: []
      },
      model: {
        label: "Modelo",
        title: "Criterios do Modelo",
        items: [
          "O relevo ainda funciona como uma classificacao manual para representar a variacao altimetrica. A leitura automatica de DEM ou MDT ainda nao foi integrada.",
          "O percentual de checkpoints vai de 0% a 100%. Se esse valor reduzir demais os GCPs, o app recompoe a rede para manter pelo menos 5 pontos de controle.",
          "A densidade apresentada no painel e calculada dividindo o total de pontos gerados pela area do poligono em km2."
        ],
        references: BASE_REFERENCES
      },
      recommendations: {
        label: "Resultados",
        title: "Recomendacoes e Referencias",
        items:
          messages.length > 0
            ? messages
            : ["Gere os pontos para visualizar aqui as recomendacoes textuais do cenario atual."],
        references: references.length > 0 ? references : BASE_REFERENCES
      }
    };
  }, [messages, references]);

  const activePanel = activeInfoPanel ? infoPanels[activeInfoPanel] : null;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <p className="eyebrow">Planejamento Fotogrametrico</p>
          <h1>GCP Planner App</h1>
        </div>
        <p className="sidebar-intro">
          Defina uma area, ajuste o cenario de voo e gere uma distribuicao inicial de GCPs e
          checkpoints para apoio de campo.
        </p>
      </div>

      <section className="sidebar-section">
        <div className="section-heading">
          <h2>Area do Projeto</h2>
          <span className={`status-pill ${areaStats ? "status-ready" : "status-waiting"}`}>
            {areaStats ? "Area definida" : "Aguardando poligono"}
          </span>
        </div>
        <div className="metrics-grid">
          <Metric label="Area" value={areaStats ? formatArea(areaStats.areaSqm) : "--"} />
          <Metric label="Hectares" value={areaStats ? formatHectares(areaStats.areaHa) : "--"} />
          <Metric label="km2" value={areaStats ? formatSquareKilometers(areaStats.areaSqKm) : "--"} />
          <Metric label="Vertices" value={areaStats ? String(areaStats.vertexCount) : "--"} />
        </div>
      </section>

      <section className="sidebar-section">
        <div className="section-heading">
          <h2>Parametros</h2>
        </div>

        <label className="field">
          <span>Altura de voo (m)</span>
          <input
            type="number"
            min="20"
            max="400"
            value={params.flightHeight}
            onChange={(event) =>
              onParamsChange({ ...params, flightHeight: Number(event.target.value) || 0 })
            }
          />
        </label>

        <label className="field">
          <span>Tipo de relevo</span>
          <select
            value={params.terrain}
            onChange={(event) => onParamsChange({ ...params, terrain: event.target.value })}
          >
            <option value="plano">Plano</option>
            <option value="ondulado">Ondulado</option>
            <option value="acidentado">Acidentado</option>
          </select>
        </label>

        <label className="field">
          <span>Nivel de precisao</span>
          <select
            value={params.precision}
            onChange={(event) => onParamsChange({ ...params, precision: event.target.value })}
          >
            <option value="baixa">Baixa</option>
            <option value="media">Media</option>
            <option value="alta">Alta</option>
          </select>
        </label>

        <label className="field">
          <span>Percentual de checkpoints</span>
          <div className="inline-field inline-field--checkpoint">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={params.checkpointPercent}
              onChange={(event) =>
                onParamsChange({ ...params, checkpointPercent: Number(event.target.value) })
              }
            />
            <input
              className="inline-field__number"
              type="number"
              min="0"
              max="100"
              step="1"
              value={params.checkpointPercent}
              onChange={(event) =>
                onParamsChange({ ...params, checkpointPercent: Number(event.target.value) })
              }
            />
          </div>
        </label>

        <div className="action-row">
          <button
            className="primary-button"
            type="button"
            onClick={onGeneratePoints}
            disabled={loading}
          >
            <ButtonIcon variant="generate" />
            Gerar Pontos
          </button>
          <button className="secondary-button" type="button" onClick={onExport} disabled={loading}>
            <ButtonIcon variant="export" />
            Exportar
          </button>
          <button className="ghost-button" type="button" onClick={onClearArea} disabled={loading}>
            <ButtonIcon variant="clear" />
            Limpar Area
          </button>
        </div>

        <div className="inline-actions">
          <label className="field compact-field">
            <span>Formato</span>
            <select value={exportFormat} onChange={(event) => onExportFormatChange(event.target.value)}>
              <option value="csv">CSV</option>
              <option value="geojson">GeoJSON</option>
              <option value="gpx">GPX (GPS)</option>
              <option value="kml">KML</option>
            </select>
          </label>

          <button
            className="ghost-button compact-button"
            type="button"
            onClick={onTogglePointEditor}
            disabled={loading || !areaStats}
          >
            <ButtonIcon variant="edit-points" />
            {pointEditorEnabled ? "Encerrar edicao" : "Editar pontos"}
          </button>
        </div>

        {pointEditorEnabled ? (
          <div className="manual-point-tools">
            <div className="manual-point-tools__row">
              <button
                className={`ghost-button compact-button ${pointPlacementType === "GCP" ? "ghost-button--active" : ""}`}
                type="button"
                onClick={() => onStartPointPlacement("GCP")}
                disabled={loading}
              >
                <ButtonIcon variant="add-gcp" />
                Adicionar controle
              </button>
              <button
                className={`ghost-button compact-button ${pointPlacementType === "CHECKPOINT" ? "ghost-button--active" : ""}`}
                type="button"
                onClick={() => onStartPointPlacement("CHECKPOINT")}
                disabled={loading}
              >
                <ButtonIcon variant="add-checkpoint" />
                Adicionar checkpoint
              </button>
            </div>

            {pointPlacementType ? (
              <div className="manual-point-tools__status">
                <p>
                  Clique no mapa dentro do poligono para inserir um{" "}
                  {pointPlacementType === "GCP" ? "controle" : "checkpoint"}.
                </p>
                <button
                  className="ghost-button compact-button"
                  type="button"
                  onClick={onCancelPointPlacement}
                >
                  Cancelar insercao
                </button>
              </div>
            ) : (
              <p className="manual-point-tools__hint">
                Ative um dos modos acima para inserir pontos manualmente sem perder os pontos ja
                gerados.
              </p>
            )}
          </div>
        ) : null}
      </section>

      <section className="sidebar-section">
        <div className="section-heading">
          <h2>Diagnostico</h2>
        </div>

        {summary ? (
          <div className="metrics-grid">
            <Metric label="GCP" value={String(summary.gcpCount)} />
            <Metric label="Checkpoints" value={String(summary.checkpointCount)} />
            <Metric label="Total" value={String(summary.totalReferencePoints)} />
            <Metric
              label="Densidade"
              value={formatDensityPerSquareKilometer(summary.densityPerSqKm)}
            />
          </div>
        ) : (
          <p className="empty-state">
            O app combina area, relevo, precisao e percentual de checkpoints para explicar por que
            uma determinada rede de apoio foi sugerida.
          </p>
        )}

        {error ? <p className="error-banner">{error}</p> : null}
      </section>

      <section className="sidebar-section">
        <div className="section-heading">
          <h2>Informacoes e Referencias</h2>
        </div>

        <div className="info-panel">
          <div className="info-panel__actions">
            {Object.entries(infoPanels).map(([key, panel]) => (
              <button
                key={key}
                className={`info-panel__tab ${activeInfoPanel === key ? "info-panel__tab--active" : ""}`}
                type="button"
                onClick={() => setActiveInfoPanel((current) => (current === key ? "" : key))}
              >
                {panel.label}
              </button>
            ))}
          </div>

          {activePanel ? (
            <div className="info-panel__body">
              <div className="info-panel__header">
                <div>
                  <h3>{activePanel.title}</h3>
                  <p>Clique em fechar para recolher este painel.</p>
                </div>
                <button
                  className="ghost-button info-panel__close"
                  type="button"
                  onClick={() => setActiveInfoPanel("")}
                >
                  Fechar
                </button>
              </div>

              <div className="info-panel__content">
                {activePanel.items.map((item) => (
                  <p key={item} className="info-panel__item">
                    {item}
                  </p>
                ))}
              </div>

              {activePanel.references.length > 0 ? (
                <div className="info-panel__references">
                  <h4>Referencias</h4>
                  {activePanel.references.map((reference) => (
                    <p key={reference} className="info-panel__reference">
                      {reference}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="info-panel__placeholder">
              Abra uma aba para ver as orientacoes do app, a logica do modelo e as recomendacoes do
              cenario gerado.
            </p>
          )}
        </div>
      </section>

      <section className="sidebar-section">
        <div className="section-heading">
          <h2>Localizacao</h2>
          <span className={`status-pill ${locationStatus === "ready" ? "status-ready" : "status-waiting"}`}>
            {getLocationStatusLabel(locationStatus)}
          </span>
        </div>

        {userLocation ? (
          <div className="message-list">
            <p className="message-item">{formatLatLng(userLocation.lat, userLocation.lng)}</p>
            <p className="message-item">Precisao estimada: {formatAccuracy(userLocation.accuracy)}</p>
            <p className="message-item">Atualizado em {formatTimestamp(userLocation.timestamp)}</p>
          </div>
        ) : (
          <p className="empty-state">
            Ao permitir a geolocalizacao, o mapa passa a abrir perto do local onde o app esta sendo
            usado.
          </p>
        )}

        {locationError ? <p className="error-banner">{locationError}</p> : null}

        <button
          className="ghost-button compact-button"
          type="button"
          onClick={onRequestLocation}
          disabled={loading}
        >
          <ButtonIcon variant="locate" />
          Atualizar local
        </button>
      </section>

      <section className="sidebar-section sidebar-section--stretch">
        <div className="section-heading">
          <h2>{pointEditorEnabled ? "Editor de Pontos" : "Pontos do Projeto"}</h2>
          <span className="count-chip">{points.length}</span>
        </div>

        {points.length > 0 ? (
          <div className="point-list">
            {points.map((point) => (
              <div key={point.id} className={`point-item point-item--${point.type.toLowerCase()}`}>
                <div className="point-item__header">
                  <div>
                    <strong>{point.label}</strong>
                    <span>{point.type === "GCP" ? "Controle" : "Checkpoint"}</span>
                  </div>
                  <button className="icon-button" type="button" onClick={() => onRemovePoint(point.id)}>
                    <ButtonIcon variant="delete" />
                  </button>
                </div>
                {pointEditorEnabled ? (
                  <label className="field field--inline-select">
                    <span>Tipo do ponto</span>
                    <select value={point.type} onChange={(event) => onPointTypeChange(point.id, event.target.value)}>
                      <option value="GCP">Controle</option>
                      <option value="CHECKPOINT">Checkpoint</option>
                    </select>
                  </label>
                ) : null}
                <p>{formatLatLng(point.lat, point.lng)}</p>
                <p>{formatUtm(point.utm)}</p>
                {pointEditorEnabled ? <p>Arraste o marcador no mapa para reposicionar este ponto.</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            Gere os pontos automaticamente ou ative Editar pontos para inserir pontos manuais no
            mapa.
          </p>
        )}
      </section>
    </aside>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getLocationStatusLabel(status) {
  if (status === "ready") {
    return "Localizada";
  }

  if (status === "loading") {
    return "Buscando";
  }

  if (status === "unsupported") {
    return "Sem suporte";
  }

  if (status === "error") {
    return "Indisponivel";
  }

  return "Aguardando";
}

function formatAccuracy(accuracy) {
  if (!Number.isFinite(accuracy)) {
    return "--";
  }

  return `${Math.round(accuracy)} m`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "--";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function ButtonIcon({ variant }) {
  if (variant === "generate") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }

  if (variant === "export") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />
      </svg>
    );
  }

  if (variant === "clear") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h14M9 7V5h6v2M8 10v7M12 10v7M16 10v7M7 7l1 12h8l1-12" />
      </svg>
    );
  }

  if (variant === "edit-points") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h4l10-10-4-4L4 16v4M14 6l4 4M9 7H5M7 11H5M13 17H5" />
      </svg>
    );
  }

  if (variant === "add-gcp") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14M12 3a9 9 0 100 18 9 9 0 000-18z" />
      </svg>
    );
  }

  if (variant === "add-checkpoint") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7v10M7 12h10M12 3l7 4v10l-7 4-7-4V7l7-4z" />
      </svg>
    );
  }

  if (variant === "locate") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    );
  }

  if (variant === "delete") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h14M9 7V5h6v2M8 10v7M12 10v7M16 10v7M7 7l1 12h8l1-12" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}

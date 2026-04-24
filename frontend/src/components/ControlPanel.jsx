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
  "Cho et al. (2026): GCPs no perímetro e no interior para cenários exigentes.",
  "Sanz-Ablanedo et al. (2018): distribuição uniforme e checkpoints independentes.",
  "Oliveira et al. (2024) e MTGIR/INCRA: considerar GSD, área, geometria, relevo e RMS."
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
        title: "Guia Rápido",
        items: [
          "Use Desenhar polígono para criar a área do projeto no mapa.",
          "Use Editar vértices para ajustar a geometria e inserir novos vértices depois.",
          "Depois de gerar a rede, você pode abrir Editar pontos para reposicionar, remover e trocar pontos entre controle e checkpoint."
        ],
        references: []
      },
      model: {
        label: "Modelo",
        title: "Critérios do Modelo",
        items: [
          "O relevo ainda funciona como uma classificação manual para representar a variação altimétrica. A leitura automática de DEM ou MDT ainda não foi integrada.",
          "O percentual de checkpoints vai de 0% a 100%. Se esse valor reduzir demais os GCPs, o app recompõe a rede para manter pelo menos 5 pontos de controle.",
          "A densidade apresentada no painel é calculada dividindo o total de pontos gerados pela área do polígono em km²."
        ],
        references: BASE_REFERENCES
      },
      recommendations: {
        label: "Resultados",
        title: "Recomendações e Referências",
        items:
          messages.length > 0
            ? messages
            : ["Gere os pontos para visualizar aqui as recomendações textuais do cenário atual."],
        references: references.length > 0 ? references : BASE_REFERENCES
      }
    };
  }, [messages, references]);

  const activePanel = activeInfoPanel ? infoPanels[activeInfoPanel] : null;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <p className="eyebrow">Planejamento Fotogramétrico</p>
          <h1>GCP Planner App</h1>
        </div>
        <p className="sidebar-intro">
          Defina uma área, ajuste o cenário de voo e gere uma distribuição inicial de GCPs e
          checkpoints para apoio de campo.
        </p>
      </div>

      <section className="sidebar-section">
        <div className="section-heading">
          <h2>Área do Projeto</h2>
          <span className={`status-pill ${areaStats ? "status-ready" : "status-waiting"}`}>
            {areaStats ? "Área definida" : "Aguardando polígono"}
          </span>
        </div>
        <div className="metrics-grid">
          <Metric label="Área" value={areaStats ? formatArea(areaStats.areaSqm) : "--"} />
          <Metric label="Hectares" value={areaStats ? formatHectares(areaStats.areaHa) : "--"} />
          <Metric label="km²" value={areaStats ? formatSquareKilometers(areaStats.areaSqKm) : "--"} />
          <Metric label="Vértices" value={areaStats ? String(areaStats.vertexCount) : "--"} />
        </div>
      </section>

      <section className="sidebar-section">
        <div className="section-heading">
          <h2>Parâmetros</h2>
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
          <span>Nível de precisão</span>
          <select
            value={params.precision}
            onChange={(event) => onParamsChange({ ...params, precision: event.target.value })}
          >
            <option value="baixa">Baixa</option>
            <option value="media">Média</option>
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
            Limpar Área
          </button>
        </div>

        <div className="inline-actions">
          <label className="field compact-field">
            <span>Formato</span>
            <select value={exportFormat} onChange={(event) => onExportFormatChange(event.target.value)}>
              <option value="csv">CSV</option>
              <option value="geojson">GeoJSON</option>
              <option value="kml">KML</option>
            </select>
          </label>

          <button
            className="ghost-button compact-button"
            type="button"
            onClick={onTogglePointEditor}
            disabled={loading || !points.length}
          >
            <ButtonIcon variant="edit-points" />
            {pointEditorEnabled ? "Encerrar edição" : "Editar pontos"}
          </button>
        </div>
      </section>

      <section className="sidebar-section">
        <div className="section-heading">
          <h2>Diagnóstico</h2>
        </div>

        {summary ? (
          <>
            <div className="metrics-grid">
              <Metric label="GCP" value={String(summary.gcpCount)} />
              <Metric label="Checkpoints" value={String(summary.checkpointCount)} />
              <Metric label="Total" value={String(summary.totalReferencePoints)} />
              <Metric
                label="Densidade"
                value={formatDensityPerSquareKilometer(summary.densityPerSqKm)}
              />
            </div>

            {summary.breakdown ? (
              <div className="factor-grid">
                <FactorCard
                  label="Base da área"
                  value={`+${summary.breakdown.areaBasePoints}`}
                  detail="Quantidade inicial pela área desenhada"
                />
                <FactorCard
                  label="Relevo"
                  value={`+${summary.breakdown.terrainExtraPoints}`}
                  detail={summary.breakdown.terrainLabel}
                />
                <FactorCard
                  label="Precisão"
                  value={`+${summary.breakdown.precisionExtraPoints}`}
                  detail={`Nível ${getPrecisionLabel(params.precision)}`}
                />
                <FactorCard
                  label="Altura do voo"
                  value={`+${summary.breakdown.flightHeightExtraPoints}`}
                  detail={`${summary.breakdown.flightHeightLabel} (${params.flightHeight} m)`}
                />
                <FactorCard
                  label="Checkpoints"
                  value={`${summary.breakdown.requestedCheckpointPercent}%`}
                  detail={`Efetivo ${summary.breakdown.effectiveCheckpointPercent}% na rede final`}
                />
                <FactorCard
                  label="Espaçamento"
                  value={`${summary.breakdown.minimumSpacingKm} km`}
                  detail="Distância mínima entre candidatos"
                />
                <FactorCard
                  label="Folga da borda"
                  value={`${summary.breakdown.minimumInteriorDistanceKm} km`}
                  detail="Distância mínima em relação ao limite"
                />
              </div>
            ) : null}
          </>
        ) : (
          <p className="empty-state">
            O app combina área, relevo, precisão e percentual de checkpoints para explicar por que uma
            determinada rede de apoio foi sugerida.
          </p>
        )}

        {error ? <p className="error-banner">{error}</p> : null}
      </section>

      <section className="sidebar-section">
        <div className="section-heading">
          <h2>Informações e Referências</h2>
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
                  <h4>Referências</h4>
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
              Abra uma aba para ver as orientações do app, a lógica do modelo e as recomendações do
              cenário gerado.
            </p>
          )}
        </div>
      </section>

      <section className="sidebar-section">
        <div className="section-heading">
          <h2>Localização</h2>
          <span className={`status-pill ${locationStatus === "ready" ? "status-ready" : "status-waiting"}`}>
            {getLocationStatusLabel(locationStatus)}
          </span>
        </div>

        {userLocation ? (
          <div className="message-list">
            <p className="message-item">{formatLatLng(userLocation.lat, userLocation.lng)}</p>
            <p className="message-item">Precisão estimada: {formatAccuracy(userLocation.accuracy)}</p>
            <p className="message-item">Atualizado em {formatTimestamp(userLocation.timestamp)}</p>
          </div>
        ) : (
          <p className="empty-state">
            Ao permitir a geolocalização, o mapa passa a abrir perto do local onde o app está sendo usado.
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
          <h2>{pointEditorEnabled ? "Editor de Pontos" : "Pontos Gerados"}</h2>
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
            Os pontos aparecerão aqui com coordenadas geográficas e UTM depois da geração.
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

function FactorCard({ label, value, detail }) {
  return (
    <div className="factor-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
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
    return "Indisponível";
  }

  return "Aguardando";
}

function getPrecisionLabel(precision) {
  if (precision === "alta") {
    return "alta";
  }

  if (precision === "baixa") {
    return "baixa";
  }

  return "média";
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

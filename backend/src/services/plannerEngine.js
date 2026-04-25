import * as turf from "@turf/turf";

const AREA_RULES = [
  { maxHa: 5, totalPoints: 5, label: "area pequena" },
  { maxHa: 20, totalPoints: 8, label: "area media" },
  { maxHa: 60, totalPoints: 12, label: "area grande" },
  { maxHa: 120, totalPoints: 16, label: "area muito grande" }
];

const TERRAIN_RULES = {
  plano: {
    extraPoints: 0,
    densityBoost: 0,
    insetFactor: 1,
    spacingFactor: 1.04,
    label: "relevo plano"
  },
  ondulado: {
    extraPoints: 1,
    densityBoost: 0.18,
    insetFactor: 1.12,
    spacingFactor: 0.92,
    label: "relevo ondulado"
  },
  acidentado: {
    extraPoints: 2,
    densityBoost: 0.38,
    insetFactor: 1.24,
    spacingFactor: 0.82,
    label: "relevo acidentado"
  }
};

const PRECISION_RULES = {
  baixa: { extraPoints: 0, label: "precisao baixa" },
  media: { extraPoints: 2, label: "precisao media" },
  alta: { extraPoints: 4, label: "precisao alta" }
};

export function buildPlan(payload = {}) {
  const polygon = normalizePolygon(payload.polygon);
  const params = normalizeParams(payload.params);

  const areaSqm = turf.area(polygon);
  if (!Number.isFinite(areaSqm) || areaSqm <= 0) {
    throw new Error("A area desenhada e invalida.");
  }

  const areaHa = areaSqm / 10000;
  const areaSqKm = areaSqm / 1000000;

  const areaRule = getAreaRule(areaHa);
  const terrainRule = TERRAIN_RULES[params.terrain];
  const precisionRule = PRECISION_RULES[params.precision];
  const heightRule = getFlightHeightRule(params.flightHeight);
  const polygonScale = getPolygonScaleMetrics(polygon);
  const terrainAdjustment = getTerrainAdjustment(areaRule.totalPoints, terrainRule);
  const heightAdjustment = getHeightAdjustment(areaRule.totalPoints, heightRule);

  let totalReferencePoints =
    areaRule.totalPoints + terrainAdjustment + precisionRule.extraPoints + heightAdjustment;
  if (areaHa > 120) {
    totalReferencePoints = Math.max(totalReferencePoints, Math.ceil(areaSqKm * 10) + 4);
  }

  let checkpointCount = clamp(
    Math.round(totalReferencePoints * (params.checkpointPercent / 100)),
    0,
    totalReferencePoints
  );

  let gcpCount = totalReferencePoints - checkpointCount;
  if (gcpCount < 5) {
    gcpCount = 5;
    totalReferencePoints = gcpCount + checkpointCount;
  }

  const minimumSpacingKm = getMinimumSpacing(areaSqKm, totalReferencePoints, terrainRule, heightRule);
  const minimumInteriorDistanceKm = getEdgeMargin(
    areaSqKm,
    minimumSpacingKm,
    terrainRule,
    heightRule,
    polygonScale
  );
  const edgeClearanceKm = clamp(minimumInteriorDistanceKm * 0.58, 0.018, minimumInteriorDistanceKm);
  const interiorClearanceKm = clamp(
    Math.max(minimumInteriorDistanceKm * 0.92, edgeClearanceKm * 1.2),
    edgeClearanceKm,
    Math.max(edgeClearanceKm, minimumInteriorDistanceKm * 1.12)
  );
  const edgePolygon = buildInsetPlanningPolygon(polygon, edgeClearanceKm);
  const interiorPolygon = buildInsetPlanningPolygon(polygon, interiorClearanceKm);
  const anchorPoint = getAnchorPoint(polygon);
  const orientationDegrees = getDominantAxisDegrees(polygon);

  const vertexCandidates = collectVertexCandidates(polygon, edgePolygon, anchorPoint, edgeClearanceKm);
  const edgeCandidates = collectEdgeCandidates(
    polygon,
    anchorPoint,
    edgeClearanceKm,
    Math.max(totalReferencePoints * 8, 40)
  );
  const interiorCandidates = collectInteriorCandidates(
    polygon,
    interiorPolygon,
    anchorPoint,
    orientationDegrees,
    interiorClearanceKm,
    Math.max(totalReferencePoints * 6, 42)
  );

  let gcpCoordinates = selectLayeredCoveragePoints({
    totalCount: gcpCount,
    quotas: getGcpLayerQuotas(gcpCount, vertexCandidates.length),
    vertexCandidates,
    edgeCandidates,
    interiorCandidates,
    existingPoints: [],
    minimumSpacingKm
  });

  let checkpointCoordinates = selectLayeredCoveragePoints({
    totalCount: checkpointCount,
    quotas: getCheckpointLayerQuotas(checkpointCount, vertexCandidates.length),
    vertexCandidates,
    edgeCandidates,
    interiorCandidates,
    existingPoints: gcpCoordinates,
    minimumSpacingKm: Math.max(0.008, minimumSpacingKm * 0.92)
  }).filter(
    (coordinates) => !gcpCoordinates.some((point) => toCoordinateKey(point) === toCoordinateKey(coordinates))
  );

  gcpCount = gcpCoordinates.length;
  checkpointCount = checkpointCoordinates.length;
  totalReferencePoints = gcpCount + checkpointCount;
  const effectiveCheckpointPercent =
    totalReferencePoints > 0 ? Number(((checkpointCount / totalReferencePoints) * 100).toFixed(1)) : 0;

  const gcpPoints = gcpCoordinates.map((coordinates, index) => ({
    id: `gcp-${index + 1}`,
    label: `GCP ${index + 1}`,
    type: "GCP",
    coordinates
  }));

  const checkpointPoints = checkpointCoordinates.map((coordinates, index) => ({
    id: `checkpoint-${index + 1}`,
    label: `Checkpoint ${index + 1}`,
    type: "CHECKPOINT",
    coordinates
  }));

  return {
    summary: {
      areaSqm,
      areaHa,
      areaSqKm,
      terrain: params.terrain,
      precision: params.precision,
      flightHeight: params.flightHeight,
      checkpointPercent: params.checkpointPercent,
      effectiveCheckpointPercent,
      totalReferencePoints,
      gcpCount,
      checkpointCount,
      densityPerSqKm: Number((totalReferencePoints / Math.max(areaSqKm, 0.01)).toFixed(2)),
      breakdown: {
        areaBasePoints: areaRule.totalPoints,
        terrainExtraPoints: terrainAdjustment,
        precisionExtraPoints: precisionRule.extraPoints,
        flightHeightExtraPoints: heightAdjustment,
        terrainLabel: terrainRule.label,
        flightHeightLabel: heightRule.label,
        requestedCheckpointPercent: params.checkpointPercent,
        effectiveCheckpointPercent,
        minimumSpacingKm: Number(minimumSpacingKm.toFixed(3)),
        minimumInteriorDistanceKm: Number(minimumInteriorDistanceKm.toFixed(3)),
        edgeClearanceKm: Number(edgeClearanceKm.toFixed(3)),
        interiorClearanceKm: Number(interiorClearanceKm.toFixed(3)),
        reliefSource: "manual-classification"
      }
    },
    explanation: buildExplanation({
      areaRule,
      terrainRule,
      precisionRule,
      heightRule,
      terrainAdjustment,
      heightAdjustment,
      gcpCount,
      checkpointCount,
      areaHa
    }),
    points: [...gcpPoints, ...checkpointPoints],
    references: [
      "Cho et al. (2026): GCPs no perimetro e no interior para cenarios exigentes.",
      "Sanz-Ablanedo et al. (2018): distribuicao uniforme e checkpoints independentes.",
      "Oliveira et al. (2024) e MTGIR/INCRA: considerar GSD, area, geometria, relevo e RMS."
    ]
  };
}

function normalizePolygon(feature) {
  if (!feature || feature.type !== "Feature" || !feature.geometry || feature.geometry.type !== "Polygon") {
    throw new Error("Desenhe uma area valida no mapa antes de gerar os pontos.");
  }

  const coordinates = feature.geometry.coordinates?.[0];
  if (!Array.isArray(coordinates) || coordinates.length < 4) {
    throw new Error("O poligono precisa ter ao menos tres vertices.");
  }

  return turf.polygon([ensureClosedRing(coordinates)], feature.properties || {});
}

function normalizeParams(params = {}) {
  const checkpointPercent = Number(params.checkpointPercent);

  return {
    flightHeight: Number(params.flightHeight) || 80,
    terrain: TERRAIN_RULES[params.terrain] ? params.terrain : "plano",
    precision: PRECISION_RULES[params.precision] ? params.precision : "media",
    checkpointPercent: clamp(Number.isFinite(checkpointPercent) ? checkpointPercent : 20, 0, 100)
  };
}

function getAreaRule(areaHa) {
  return (
    AREA_RULES.find((rule) => areaHa <= rule.maxHa) || {
      maxHa: Number.POSITIVE_INFINITY,
      totalPoints: 20,
      label: "area extensa"
    }
  );
}

function getFlightHeightRule(flightHeight) {
  if (flightHeight <= 60) {
    return { extraPoints: 0, densityBoost: 0, spacingFactor: 1.08, label: "baixa" };
  }

  if (flightHeight <= 120) {
    return { extraPoints: 1, densityBoost: 0.08, spacingFactor: 0.98, label: "intermediaria" };
  }

  if (flightHeight <= 180) {
    return { extraPoints: 2, densityBoost: 0.16, spacingFactor: 0.9, label: "alta" };
  }

  return { extraPoints: 3, densityBoost: 0.26, spacingFactor: 0.82, label: "muito alta" };
}

function getTerrainAdjustment(basePointCount, terrainRule) {
  return terrainRule.extraPoints + Math.round(basePointCount * terrainRule.densityBoost);
}

function getHeightAdjustment(basePointCount, heightRule) {
  return heightRule.extraPoints + Math.round(basePointCount * heightRule.densityBoost);
}

function buildExplanation(context) {
  const messages = [];
  messages.push(
    `A sugestao inicial partiu da classificacao da area como ${context.areaRule.label}, com ${context.areaHa.toFixed(2)} ha.`
  );
  messages.push(
    `A base da area sugeriu ${context.areaRule.totalPoints} pontos. O ${context.terrainRule.label} acrescentou ${context.terrainAdjustment}, a ${context.precisionRule.label} acrescentou ${context.precisionRule.extraPoints} e a altura de voo ${context.heightRule.label} acrescentou ${context.heightAdjustment}.`
  );
  messages.push(
    `${context.gcpCount} pontos foram reservados como GCP e ${context.checkpointCount} como checkpoints independentes, seguindo a recomendacao de nao avaliar acuracia apenas com pontos de controle.`
  );
  messages.push(
    "A distribuicao combina vertices, bordas e malha interior, com selecao espacial por distancia para evitar concentracao no centro e manter cobertura mais homogenea da area."
  );
  messages.push(
    "Nesta versao o relevo ainda e informado manualmente no painel e usado como proxy de variacao altimetrica. A leitura automatica de DEM ou MDT ainda nao foi integrada."
  );
  return messages;
}

function getGcpLayerQuotas(totalCount, vertexCandidateCount) {
  if (totalCount <= 0) {
    return { vertexCount: 0, edgeCount: 0, interiorCount: 0 };
  }

  const preferredVertexCount =
    totalCount >= 8
      ? Math.min(4, vertexCandidateCount)
      : Math.min(vertexCandidateCount, Math.max(2, totalCount - 2));
  const remaining = Math.max(0, totalCount - preferredVertexCount);
  const edgeCount = Math.min(remaining, Math.max(0, Math.round(remaining * 0.6)));
  const interiorCount = Math.max(0, totalCount - preferredVertexCount - edgeCount);

  return {
    vertexCount: preferredVertexCount,
    edgeCount,
    interiorCount
  };
}

function getCheckpointLayerQuotas(totalCount, vertexCandidateCount) {
  if (totalCount <= 0) {
    return { vertexCount: 0, edgeCount: 0, interiorCount: 0 };
  }

  const vertexCount =
    totalCount >= 5 ? Math.min(2, vertexCandidateCount) : totalCount >= 3 ? Math.min(1, vertexCandidateCount) : 0;
  const remaining = Math.max(0, totalCount - vertexCount);
  const edgeCount = Math.min(remaining, Math.max(1, Math.round(remaining * 0.45)));
  const interiorCount = Math.max(0, totalCount - vertexCount - edgeCount);

  return {
    vertexCount,
    edgeCount,
    interiorCount
  };
}

function selectLayeredCoveragePoints({
  totalCount,
  quotas,
  vertexCandidates,
  edgeCandidates,
  interiorCandidates,
  existingPoints = [],
  minimumSpacingKm
}) {
  if (totalCount <= 0) {
    return [];
  }

  const selected = [];
  const occupied = [...existingPoints];
  const vertexSpacingKm = Math.max(0.003, minimumSpacingKm * 0.28);
  const edgeSpacingKm = Math.max(0.003, minimumSpacingKm * 0.38);
  const interiorSpacingKm = Math.max(0.003, minimumSpacingKm * 0.5);
  const fillSpacingKm = Math.max(0.003, minimumSpacingKm * 0.26);

  const selectFromLayer = (candidates, desiredCount, spacingKm) => {
    if (desiredCount <= 0) {
      return;
    }

    const filteredCandidates = filterFarFrom(candidates, occupied, spacingKm);
    const picks = farthestPointSampling(filteredCandidates, desiredCount, occupied);
    selected.push(...picks);
    occupied.push(...picks);
  };

  selectFromLayer(vertexCandidates, quotas.vertexCount, vertexSpacingKm);
  selectFromLayer(edgeCandidates, quotas.edgeCount, edgeSpacingKm);
  selectFromLayer(interiorCandidates, quotas.interiorCount, interiorSpacingKm);

  if (selected.length < totalCount) {
    const fillCandidates = dedupeCoordinates([
      ...edgeCandidates,
      ...interiorCandidates,
      ...vertexCandidates
    ]);
    selectFromLayer(fillCandidates, totalCount - selected.length, fillSpacingKm);
  }

  return dedupeCoordinates(selected).slice(0, totalCount);
}

function collectVertexCandidates(polygon, insetPolygon, anchorPoint, clearanceKm) {
  const insetBoundary = turf.lineString(insetPolygon.geometry.coordinates[0]);

  return dedupeCoordinates(
    getRingCoordinates(polygon)
      .map((vertex) => {
        const projected = projectPointToInsetBoundary(vertex, anchorPoint, insetBoundary);
        return pullPointInside(polygon, projected || vertex, clearanceKm, anchorPoint);
      })
      .filter((coordinates) =>
        turf.booleanPointInPolygon(turf.point(coordinates), polygon, { ignoreBoundary: false })
      )
  );
}

function collectEdgeCandidates(polygon, anchorPoint, clearanceKm, desiredCount) {
  const boundaryLine = turf.lineString(polygon.geometry.coordinates[0]);
  const rawCandidates = dedupeCoordinates([
    ...sampleBoundaryAnchors(boundaryLine, Math.max(desiredCount, 18), 0),
    ...sampleBoundaryAnchors(boundaryLine, Math.max(desiredCount, 18), 0.33),
    ...sampleBoundaryAnchors(boundaryLine, Math.max(desiredCount, 18), 0.66),
    ...generateBoundaryCandidates(boundaryLine, Math.max(desiredCount, 24))
  ]);

  return filterByBoundaryDistance(
    polygon,
    dedupeCoordinates(
      rawCandidates
        .map((coordinates) => pullPointInside(polygon, coordinates, clearanceKm, anchorPoint))
        .filter((coordinates) =>
          turf.booleanPointInPolygon(turf.point(coordinates), polygon, { ignoreBoundary: false })
        )
    ),
    Math.max(0.01, clearanceKm * 0.82)
  );
}

function collectInteriorCandidates(
  polygon,
  interiorPolygon,
  anchorPoint,
  orientationDegrees,
  clearanceKm,
  desiredCount
) {
  const rawCandidates = dedupeCoordinates([
    ...generateUniformCoverageCoordinates(
      interiorPolygon,
      Math.max(desiredCount * 2, desiredCount + 12),
      anchorPoint,
      orientationDegrees
    ),
    ...generateInteriorCandidates(interiorPolygon, Math.max(desiredCount * 3, 24)),
    ...generateFallbackCoverageCoordinates(
      interiorPolygon,
      Math.max(desiredCount * 2, 18),
      anchorPoint,
      orientationDegrees
    )
  ]);

  return filterByBoundaryDistance(
    polygon,
    dedupeCoordinates(
      rawCandidates
        .map((coordinates) => pullPointInside(polygon, coordinates, clearanceKm, anchorPoint))
        .filter((coordinates) =>
          turf.booleanPointInPolygon(turf.point(coordinates), polygon, { ignoreBoundary: false })
        )
    ),
    Math.max(0.01, clearanceKm * 0.9)
  );
}

function projectPointToInsetBoundary(targetPoint, anchorPoint, insetBoundary) {
  const guideLine = turf.lineString([anchorPoint, targetPoint]);
  const intersections = turf.lineIntersect(guideLine, insetBoundary).features;

  if (!intersections.length) {
    return null;
  }

  intersections.sort((left, right) => {
    const leftDistance = turf.distance(left, turf.point(targetPoint), { units: "kilometers" });
    const rightDistance = turf.distance(right, turf.point(targetPoint), { units: "kilometers" });
    return leftDistance - rightDistance;
  });

  return intersections[0].geometry.coordinates;
}

function getMinimumSpacing(areaSqKm, totalReferencePoints, terrainRule, heightRule) {
  if (areaSqKm <= 0.03) {
    return clamp(0.01 * terrainRule.spacingFactor * heightRule.spacingFactor, 0.008, 0.14);
  }

  const baseSpacingKm = Math.sqrt(areaSqKm / Math.max(totalReferencePoints, 5)) * 0.4;
  return clamp(baseSpacingKm * terrainRule.spacingFactor * heightRule.spacingFactor, 0.008, 0.2);
}

function getEdgeMargin(areaSqKm, minimumSpacingKm, terrainRule, heightRule, polygonScale) {
  const areaBiasKm = Math.sqrt(Math.max(areaSqKm, 0.0001)) * 0.035 * terrainRule.insetFactor;
  const densityBiasKm = minimumSpacingKm * 1.05;
  const heightBiasKm = minimumSpacingKm * (0.08 + heightRule.densityBoost * 0.16);
  const marginCapKm = Math.min(0.18, Math.max(0.035, polygonScale.minDimensionKm * 0.12));

  return clamp(Math.max(densityBiasKm + heightBiasKm, areaBiasKm + densityBiasKm * 0.55), 0.03, marginCapKm);
}

function getPolygonScaleMetrics(polygon) {
  const [minX, minY, maxX, maxY] = turf.bbox(polygon);
  const widthKm = turf.distance([minX, minY], [maxX, minY], { units: "kilometers" });
  const heightKm = turf.distance([minX, minY], [minX, maxY], { units: "kilometers" });
  const fallbackDimensionKm = Math.sqrt(Math.max(turf.area(polygon) / 1000000, 0.0001));
  const minDimensionKm = Math.max(
    0.02,
    Number.isFinite(widthKm) && Number.isFinite(heightKm)
      ? Math.min(widthKm, heightKm)
      : fallbackDimensionKm
  );
  const maxDimensionKm = Math.max(
    minDimensionKm,
    Number.isFinite(widthKm) && Number.isFinite(heightKm)
      ? Math.max(widthKm, heightKm)
      : fallbackDimensionKm
  );

  return {
    minDimensionKm,
    maxDimensionKm
  };
}

function buildInsetPlanningPolygon(polygon, insetDistanceKm) {
  let currentInsetKm = insetDistanceKm;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const buffered = turf.buffer(polygon, -currentInsetKm, { units: "kilometers" });
    const candidatePolygon = pickLargestPolygon(buffered);

    if (candidatePolygon && candidatePolygon.geometry.coordinates?.[0]?.length >= 4) {
      return candidatePolygon;
    }

    currentInsetKm *= 0.55;
  }

  return polygon;
}

function getAnchorPoint(polygon) {
  const centerOfMass = turf.centerOfMass(polygon);

  if (turf.booleanPointInPolygon(centerOfMass, polygon, { ignoreBoundary: false })) {
    return centerOfMass.geometry.coordinates;
  }

  return turf.pointOnFeature(polygon).geometry.coordinates;
}

function pickLargestPolygon(feature) {
  if (!feature?.geometry) {
    return null;
  }

  if (feature.geometry.type === "Polygon") {
    return turf.polygon(feature.geometry.coordinates, feature.properties || {});
  }

  if (feature.geometry.type !== "MultiPolygon") {
    return null;
  }

  let bestCoordinates = null;
  let bestArea = -Infinity;

  for (const polygonCoordinates of feature.geometry.coordinates) {
    const polygonFeature = turf.polygon(polygonCoordinates, feature.properties || {});
    const polygonArea = turf.area(polygonFeature);
    if (polygonArea > bestArea) {
      bestArea = polygonArea;
      bestCoordinates = polygonCoordinates;
    }
  }

  return bestCoordinates ? turf.polygon(bestCoordinates, feature.properties || {}) : null;
}

function getRingCoordinates(polygon) {
  const ring = polygon?.geometry?.coordinates?.[0] || [];
  return ring.length > 1 ? ring.slice(0, -1) : [];
}

function generateBoundaryCandidates(boundaryLine, desiredCount) {
  const lengthKm = turf.length(boundaryLine, { units: "kilometers" });
  if (!Number.isFinite(lengthKm) || lengthKm <= 0) {
    return [];
  }

  const sampleCount = Math.max(12, desiredCount);
  const coordinates = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const fraction = index / sampleCount;
    const point = turf.along(boundaryLine, lengthKm * fraction, { units: "kilometers" });
    coordinates.push(point.geometry.coordinates);
  }
  return coordinates;
}

function generateInteriorCandidates(polygon, desiredCount) {
  const bbox = turf.bbox(polygon);
  const areaSqKm = turf.area(polygon) / 1000000;

  let gridPoints = [];
  let cellSideKm = Math.sqrt(Math.max(areaSqKm, 0.0001) / Math.max(desiredCount * 1.6, 6));
  cellSideKm = clamp(cellSideKm, 0.008, 0.35);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const grid = turf.pointGrid(bbox, cellSideKm, { units: "kilometers", mask: polygon });
    gridPoints = grid.features.map((feature) => feature.geometry.coordinates);
    if (gridPoints.length >= desiredCount || cellSideKm <= 0.0085) {
      break;
    }
    cellSideKm *= 0.72;
  }

  return gridPoints;
}

function generateUniformCoverageCoordinates(polygon, desiredCount, anchorPoint, orientationDegrees) {
  if (desiredCount <= 0) {
    return [];
  }

  const rotatedPolygon = turf.transformRotate(polygon, -orientationDegrees, { pivot: anchorPoint });
  const rotatedCandidates = generateBestHexCandidates(rotatedPolygon, desiredCount);
  const candidates = dedupeCoordinates(
    rotatedCandidates
      .map((coordinates) => rotateCoordinates(coordinates, orientationDegrees, anchorPoint))
      .filter((coordinates) =>
        turf.booleanPointInPolygon(turf.point(coordinates), polygon, { ignoreBoundary: false })
      )
  );

  if (candidates.length <= desiredCount) {
    return candidates;
  }

  return selectCoveragePoints(candidates, desiredCount, [], anchorPoint, orientationDegrees);
}

function generateFallbackCoverageCoordinates(polygon, desiredCount, anchorPoint, orientationDegrees) {
  if (desiredCount <= 0) {
    return [];
  }

  const rotatedPolygon = turf.transformRotate(polygon, -orientationDegrees, { pivot: anchorPoint });
  const rotatedBoundary = generateBoundaryCandidates(
    turf.lineString(rotatedPolygon.geometry.coordinates[0]),
    Math.max(12, Math.round(desiredCount * 0.75))
  );
  const rotatedInterior = generateInteriorCandidates(rotatedPolygon, desiredCount);

  return dedupeCoordinates(
    [...rotatedBoundary, ...rotatedInterior]
      .map((coordinates) => rotateCoordinates(coordinates, orientationDegrees, anchorPoint))
      .filter((coordinates) =>
        turf.booleanPointInPolygon(turf.point(coordinates), polygon, { ignoreBoundary: false })
      )
  );
}

function generateBestHexCandidates(polygon, desiredCount) {
  const areaSqKm = turf.area(polygon) / 1000000;
  const bbox = turf.bbox(polygon);
  const baseCellSideKm = clamp(
    Math.sqrt(Math.max(areaSqKm, 0.0001) / (Math.max(desiredCount, 1) * 2.598076211)),
    0.01,
    0.45
  );
  const scales = [0.5, 0.58, 0.66, 0.74, 0.82, 0.9, 0.98, 1.06, 1.14, 1.22, 1.32, 1.44];

  let bestCandidates = [];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const scale of scales) {
    const cellSideKm = clamp(baseCellSideKm * scale, 0.008, 0.5);
    const grid = turf.hexGrid(bbox, cellSideKm, { units: "kilometers" });
    const candidates = dedupeCoordinates(
      grid.features
        .map((feature) => turf.centerOfMass(feature).geometry.coordinates)
        .filter((coordinates) =>
          turf.booleanPointInPolygon(turf.point(coordinates), polygon, { ignoreBoundary: false })
        )
    );

    if (!candidates.length) {
      continue;
    }

    const score =
      candidates.length >= desiredCount
        ? candidates.length - desiredCount
        : (desiredCount - candidates.length) * 6 + 50;

    if (score < bestScore) {
      bestScore = score;
      bestCandidates = candidates;
    }
  }

  return bestCandidates;
}

function selectCoveragePoints(candidates, desiredCount, existingPoints, anchorPoint, orientationDegrees) {
  if (desiredCount <= 0) {
    return [];
  }

  const pool = filterFarFrom(dedupeCoordinates(candidates), existingPoints, 0.001);
  if (pool.length <= desiredCount) {
    return pool;
  }

  const seedCount = Math.min(desiredCount, Math.max(4, Math.min(6, desiredCount)));
  const seeds = selectExtremeSeeds(pool, anchorPoint, orientationDegrees, seedCount);
  const remainingPool = removeSelectedCoordinates(pool, seeds);

  return dedupeCoordinates([
    ...seeds,
    ...farthestPointSampling(
      remainingPool,
      desiredCount - seeds.length,
      [...existingPoints, ...seeds]
    )
  ]).slice(0, desiredCount);
}

function selectExtremeSeeds(candidates, anchorPoint, orientationDegrees, maxSeedCount) {
  if (maxSeedCount <= 0 || candidates.length === 0) {
    return [];
  }

  const rotatedPoints = candidates.map((coordinates) => ({
    original: coordinates,
    rotated: rotateCoordinates(coordinates, -orientationDegrees, anchorPoint)
  }));

  const pickExtreme = (getter, direction) => {
    return rotatedPoints.reduce((best, current) => {
      if (!best) {
        return current;
      }

      return direction === "min"
        ? getter(current.rotated) < getter(best.rotated)
          ? current
          : best
        : getter(current.rotated) > getter(best.rotated)
          ? current
          : best;
    }, null);
  };

  const extremes = [
    pickExtreme((coordinates) => coordinates[0], "min"),
    pickExtreme((coordinates) => coordinates[0], "max"),
    pickExtreme((coordinates) => coordinates[1], "min"),
    pickExtreme((coordinates) => coordinates[1], "max"),
    pickExtreme((coordinates) => coordinates[0] + coordinates[1], "min"),
    pickExtreme((coordinates) => coordinates[0] + coordinates[1], "max"),
    pickExtreme((coordinates) => coordinates[0] - coordinates[1], "min"),
    pickExtreme((coordinates) => coordinates[0] - coordinates[1], "max")
  ]
    .filter(Boolean)
    .map((item) => item.original);

  const uniqueExtremes = dedupeCoordinates(extremes);
  uniqueExtremes.sort((left, right) => {
    const leftDistance = turf.distance(turf.point(left), turf.point(anchorPoint), {
      units: "kilometers"
    });
    const rightDistance = turf.distance(turf.point(right), turf.point(anchorPoint), {
      units: "kilometers"
    });
    return rightDistance - leftDistance;
  });

  return uniqueExtremes.slice(0, maxSeedCount);
}

function removeSelectedCoordinates(candidates, selected) {
  const selectedKeys = new Set(selected.map((coordinates) => toCoordinateKey(coordinates)));
  return candidates.filter((coordinates) => !selectedKeys.has(toCoordinateKey(coordinates)));
}

function getDominantAxisDegrees(polygon) {
  const ring = getRingCoordinates(polygon);
  if (ring.length < 2) {
    return 0;
  }

  let bestAngle = 0;
  let bestLength = -Infinity;

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const lengthKm = turf.distance(turf.point(current), turf.point(next), {
      units: "kilometers"
    });

    if (lengthKm > bestLength) {
      bestLength = lengthKm;
      bestAngle = (Math.atan2(next[1] - current[1], next[0] - current[0]) * 180) / Math.PI;
    }
  }

  const normalized = ((bestAngle % 180) + 180) % 180;
  return normalized;
}

function rotateCoordinates(coordinates, angleDegrees, pivotCoordinates) {
  return turf.transformRotate(turf.point(coordinates), angleDegrees, {
    pivot: pivotCoordinates
  }).geometry.coordinates;
}

function getOuterRingGcpCount(gcpCount) {
  if (gcpCount <= 5) {
    return Math.min(4, gcpCount);
  }

  if (gcpCount <= 8) {
    return gcpCount - 2;
  }

  return Math.min(Math.max(6, Math.round(gcpCount * 0.6)), gcpCount - 2);
}

function getMiddleRingGcpCount(gcpCount, outerRingGcpCount) {
  const remaining = Math.max(0, gcpCount - outerRingGcpCount);
  if (remaining === 0) {
    return 0;
  }

  if (gcpCount <= 6) {
    return Math.min(1, remaining);
  }

  if (gcpCount <= 10) {
    return Math.min(2, remaining);
  }

  return Math.min(Math.max(2, Math.round(gcpCount * 0.22)), remaining);
}

function getCheckpointRingCount(checkpointCount) {
  if (checkpointCount <= 1) {
    return checkpointCount;
  }

  return Math.max(1, Math.round(checkpointCount * 0.67));
}

function sampleBoundaryAnchors(boundaryLine, count, offsetFraction = 0) {
  if (count <= 0) {
    return [];
  }

  const lengthKm = turf.length(boundaryLine, { units: "kilometers" });
  if (!Number.isFinite(lengthKm) || lengthKm <= 0) {
    return [];
  }

  const coordinates = [];
  for (let index = 0; index < count; index += 1) {
    const fraction = ((index + 0.5 + offsetFraction) / count) % 1;
    const point = turf.along(boundaryLine, lengthKm * fraction, { units: "kilometers" });
    coordinates.push(point.geometry.coordinates);
  }

  return coordinates;
}

function farthestPointSampling(candidates, desiredCount, seedPoints = []) {
  if (desiredCount <= 0 || candidates.length === 0) {
    return [];
  }

  const selected = [...seedPoints];
  const results = [];
  const pool = [...candidates];

  while (results.length < desiredCount && pool.length > 0) {
    let bestIndex = 0;
    let bestDistance = -Infinity;

    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      const distance = minimumDistanceToSet(candidate, selected);
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    const [picked] = pool.splice(bestIndex, 1);
    selected.push(picked);
    results.push(picked);
  }

  return results;
}

function minimumDistanceToSet(candidate, points) {
  if (!points.length) {
    return Number.POSITIVE_INFINITY;
  }

  let minimum = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = turf.distance(turf.point(candidate), turf.point(point), { units: "kilometers" });
    if (distance < minimum) {
      minimum = distance;
    }
  }
  return minimum;
}

function filterFarFrom(candidates, existing, minimumSpacingKm = 0.003) {
  return candidates.filter((candidate) => {
    return existing.every((point) => {
      const distance = turf.distance(turf.point(candidate), turf.point(point), { units: "kilometers" });
      return distance >= minimumSpacingKm;
    });
  });
}

function filterByBoundaryDistance(polygon, candidates, minimumDistanceKm) {
  const boundaryLine = turf.lineString(polygon.geometry.coordinates[0]);

  return candidates.filter((candidate) => {
    const distance = turf.pointToLineDistance(turf.point(candidate), boundaryLine, {
      units: "kilometers"
    });
    return distance >= minimumDistanceKm;
  });
}

function filterByAnchorDistance(candidates, anchorPoint, minimumDistanceKm) {
  return candidates.filter((candidate) => {
    const distance = turf.distance(turf.point(candidate), turf.point(anchorPoint), {
      units: "kilometers"
    });
    return distance >= minimumDistanceKm;
  });
}

function pullPointInside(polygon, coordinates, minimumDistanceKm, anchorPoint) {
  const boundaryLine = turf.lineString(polygon.geometry.coordinates[0]);
  const currentDistance = turf.pointToLineDistance(turf.point(coordinates), boundaryLine, {
    units: "kilometers"
  });

  if (currentDistance >= minimumDistanceKm) {
    return coordinates;
  }

  const lineToAnchor = turf.lineString([coordinates, anchorPoint]);
  const lineLengthKm = turf.length(lineToAnchor, { units: "kilometers" });
  if (!Number.isFinite(lineLengthKm) || lineLengthKm <= 0) {
    return coordinates;
  }

  let fallback = coordinates;
  let bestDistance = currentDistance;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const fraction = (0.48 * attempt) / 12;
    const candidate = turf.along(lineToAnchor, lineLengthKm * fraction, {
      units: "kilometers"
    }).geometry.coordinates;
    if (!turf.booleanPointInPolygon(turf.point(candidate), polygon, { ignoreBoundary: false })) {
      continue;
    }

    const candidateDistance = turf.pointToLineDistance(turf.point(candidate), boundaryLine, {
      units: "kilometers"
    });
    if (candidateDistance > bestDistance) {
      bestDistance = candidateDistance;
      fallback = candidate;
    }

    if (candidateDistance >= minimumDistanceKm) {
      return candidate;
    }
  }

  return fallback;
}

function dedupeCoordinates(coordinates) {
  const seen = new Set();
  return coordinates.filter((coordinate) => {
    const key = toCoordinateKey(coordinate);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function toCoordinateKey(coordinate) {
  return `${coordinate[0].toFixed(7)}:${coordinate[1].toFixed(7)}`;
}

function ensureClosedRing(coordinates) {
  const normalized = coordinates.map((coordinate) => [Number(coordinate[0]), Number(coordinate[1])]);
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return normalized;
  }
  return [...normalized, first];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

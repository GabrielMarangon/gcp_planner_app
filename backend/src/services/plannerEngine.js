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
    interiorBias: 0.82,
    spacingFactor: 1.04,
    insetFactor: 1.35,
    maxBoundaryPoints: 0,
    label: "relevo plano"
  },
  ondulado: {
    extraPoints: 1,
    densityBoost: 0.18,
    interiorBias: 0.9,
    spacingFactor: 0.9,
    insetFactor: 1.55,
    maxBoundaryPoints: 0,
    label: "relevo ondulado"
  },
  acidentado: {
    extraPoints: 2,
    densityBoost: 0.38,
    interiorBias: 0.96,
    spacingFactor: 0.78,
    insetFactor: 1.8,
    maxBoundaryPoints: 0,
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
  const insetDistanceKm = getInsetDistance(
    areaSqKm,
    minimumSpacingKm,
    terrainRule,
    heightRule,
    polygonScale
  );
  const minimumInteriorDistanceCapKm = Math.min(
    0.36,
    Math.max(0.025, polygonScale.minDimensionKm * 0.18)
  );
  const minimumInteriorDistanceKm = clamp(
    Math.max(insetDistanceKm * 1.18, minimumSpacingKm * 1.55),
    Math.min(0.02, minimumInteriorDistanceCapKm),
    minimumInteriorDistanceCapKm
  );
  const planningPolygon = buildInsetPlanningPolygon(polygon, insetDistanceKm);
  const distributionInsetDistanceCapKm = Math.min(
    0.42,
    Math.max(0.03, polygonScale.minDimensionKm * 0.22)
  );
  const distributionInsetDistanceKm = clamp(
    Math.max(insetDistanceKm * 1.28, minimumInteriorDistanceKm * 1.12),
    Math.min(0.025, distributionInsetDistanceCapKm),
    distributionInsetDistanceCapKm
  );
  const distributionPolygon = buildInsetPlanningPolygon(polygon, distributionInsetDistanceKm);
  const frameInsetDistanceCapKm = Math.min(
    0.46,
    Math.max(0.035, polygonScale.minDimensionKm * 0.26)
  );
  const frameInsetDistanceKm = clamp(
    Math.max(minimumInteriorDistanceKm * 1.18, distributionInsetDistanceKm * 1.04),
    Math.min(0.03, frameInsetDistanceCapKm),
    frameInsetDistanceCapKm
  );
  const framePolygon = buildInsetPlanningPolygon(polygon, frameInsetDistanceKm);
  const anchorPoint = getAnchorPoint(polygon, distributionInsetDistanceKm);
  const frameSeeds = dedupeCoordinates(
    generateFrameSeeds(framePolygon, anchorPoint, minimumInteriorDistanceKm)
  );
  const minimumFrameCount = Math.min(4, frameSeeds.length);

  const remainingGcp = Math.max(0, gcpCount - minimumFrameCount);
  const interiorQuota = Math.max(0, Math.round(remainingGcp * terrainRule.interiorBias));

  const desiredInteriorCandidateCount = gcpCount + checkpointCount + 28;
  const primaryInteriorPool = dedupeCoordinates(
    generateInteriorCandidates(distributionPolygon, desiredInteriorCandidateCount)
  );
  const secondaryInteriorPool = dedupeCoordinates(
    generateInteriorCandidates(planningPolygon, desiredInteriorCandidateCount + 12)
  );
  let interiorCandidates = filterByBoundaryDistance(
    polygon,
    primaryInteriorPool,
    Math.max(minimumInteriorDistanceKm * 0.95, 0.07)
  );
  if (interiorCandidates.length < Math.max(desiredInteriorCandidateCount * 0.72, gcpCount + checkpointCount + 10)) {
    interiorCandidates = dedupeCoordinates([
      ...interiorCandidates,
      ...filterByBoundaryDistance(polygon, secondaryInteriorPool, Math.max(minimumInteriorDistanceKm * 0.82, 0.06))
    ]);
  }
  interiorCandidates = filterFarFrom(interiorCandidates, frameSeeds);

  const boundarySelection = [];
  const interiorSelection = farthestPointSampling(
    interiorCandidates,
    interiorQuota,
    [...frameSeeds, ...boundarySelection]
  );

  let gcpCoordinates = [...frameSeeds.slice(0, minimumFrameCount), ...boundarySelection, ...interiorSelection];
  if (gcpCoordinates.length < gcpCount) {
    const fallbackCandidates = filterFarFrom(
      [
        ...interiorCandidates,
        ...filterByBoundaryDistance(polygon, secondaryInteriorPool, Math.max(minimumInteriorDistanceKm * 0.72, 0.05))
      ],
      gcpCoordinates,
      Math.max(0.006, minimumSpacingKm * 0.55)
    );
    gcpCoordinates = [
      ...gcpCoordinates,
      ...farthestPointSampling(fallbackCandidates, gcpCount - gcpCoordinates.length, gcpCoordinates)
    ];
  }

  gcpCoordinates = gcpCoordinates.slice(0, gcpCount);
  gcpCoordinates = gcpCoordinates.map((coordinates) =>
    pullPointInside(polygon, coordinates, minimumInteriorDistanceKm, anchorPoint)
  );

  const checkpointCandidates = filterFarFrom(interiorCandidates, gcpCoordinates, minimumSpacingKm);
  let checkpointCoordinates = farthestPointSampling(checkpointCandidates, checkpointCount, gcpCoordinates);
  if (checkpointCoordinates.length < checkpointCount) {
    const fallbackCheckpointCandidates = filterFarFrom(
      [
        ...interiorCandidates,
        ...filterByBoundaryDistance(polygon, secondaryInteriorPool, Math.max(minimumInteriorDistanceKm * 0.66, 0.05))
      ],
      [...gcpCoordinates, ...checkpointCoordinates],
      Math.max(0.005, minimumSpacingKm * 0.45)
    );
    checkpointCoordinates = [
      ...checkpointCoordinates,
      ...farthestPointSampling(
        fallbackCheckpointCandidates,
        checkpointCount - checkpointCoordinates.length,
        [...gcpCoordinates, ...checkpointCoordinates]
      )
    ];
  }
  checkpointCoordinates = checkpointCoordinates.map((coordinates) =>
    pullPointInside(polygon, coordinates, minimumInteriorDistanceKm * 1.15, anchorPoint)
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

  const explanation = buildExplanation({
    areaRule,
    terrainRule,
    precisionRule,
    heightRule,
    terrainAdjustment,
    heightAdjustment,
    params,
    totalReferencePoints,
    gcpCount,
    checkpointCount,
    areaHa
  });

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
        reliefSource: "manual-classification"
      }
    },
    explanation,
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

  const closedRing = ensureClosedRing(coordinates);
  return turf.polygon([closedRing], feature.properties || {});
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
  return AREA_RULES.find((rule) => areaHa <= rule.maxHa) || { maxHa: Infinity, totalPoints: 20, label: "area extensa" };
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
    "A distribuicao agora reduz ainda mais a proximidade com o limite do poligono, levando os pontos para dentro da area e fechando mais a malha quando o relevo manual indica maior variacao altimetrica."
  );
  messages.push(
    "Nesta versao o relevo ainda e informado manualmente no painel e usado como proxy de variacao altimetrica. A leitura automatica de DEM ou MDT ainda nao foi integrada."
  );
  return messages;
}

function generateFrameSeeds(polygon, anchorPoint, minimumInteriorDistanceKm) {
  return getRingCoordinates(polygon).map((coordinates) =>
    movePointTowardAnchor(
      coordinates,
      anchorPoint,
      Math.max(minimumInteriorDistanceKm * 0.7, 0.05),
      0.14
    )
  );
}

function generateBoundaryCandidates(boundaryLine, desiredCount) {
  const lengthKm = turf.length(boundaryLine, { units: "kilometers" });
  if (!Number.isFinite(lengthKm) || lengthKm <= 0) {
    return [];
  }

  const sampleCount = Math.max(8, desiredCount);
  const coordinates = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const fraction = (index + 0.5) / sampleCount;
    const point = turf.along(boundaryLine, lengthKm * fraction, { units: "kilometers" });
    coordinates.push(point.geometry.coordinates);
  }
  return coordinates;
}

function generateInteriorCandidates(polygon, desiredCount) {
  const bbox = turf.bbox(polygon);
  const areaSqKm = turf.area(polygon) / 1000000;
  const ringSamples = generateRingSamples(polygon);

  let gridPoints = [];
  let cellSideKm = Math.sqrt(Math.max(areaSqKm, 0.0001) / Math.max(desiredCount * 1.8, 4));
  cellSideKm = clamp(cellSideKm, 0.01, 0.4);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const grid = turf.pointGrid(bbox, cellSideKm, { units: "kilometers", mask: polygon });
    gridPoints = grid.features.map((feature) => feature.geometry.coordinates);
    if (gridPoints.length >= desiredCount) {
      break;
    }
    cellSideKm *= 0.7;
  }

  const centerOfMass = turf.centerOfMass(polygon).geometry.coordinates;
  const representativePoint = turf.pointOnFeature(polygon).geometry.coordinates;
  return dedupeCoordinates([centerOfMass, representativePoint, ...ringSamples, ...gridPoints]);
}

function buildInsetPlanningPolygon(polygon, insetDistanceKm) {
  let currentInsetKm = insetDistanceKm;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const buffered = turf.buffer(polygon, -currentInsetKm, { units: "kilometers" });
    const candidatePolygon = pickLargestPolygon(buffered);

    if (candidatePolygon && candidatePolygon.geometry.coordinates?.[0]?.length >= 4) {
      return candidatePolygon;
    }

    currentInsetKm *= 0.5;
  }

  return polygon;
}

function getAnchorPoint(polygon, insetDistanceKm) {
  const anchorPolygon = buildInsetPlanningPolygon(polygon, insetDistanceKm * 1.6);
  const centerOfMass = turf.centerOfMass(anchorPolygon);

  if (turf.booleanPointInPolygon(centerOfMass, polygon, { ignoreBoundary: false })) {
    return centerOfMass.geometry.coordinates;
  }

  return turf.pointOnFeature(anchorPolygon).geometry.coordinates;
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

  if (ring.length <= 1) {
    return [];
  }

  return ring.slice(0, -1);
}

function generateRingSamples(polygon) {
  const ring = getRingCoordinates(polygon);
  if (ring.length < 2) {
    return [];
  }

  const samples = [...ring];
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    samples.push(interpolateCoordinates(current, next, 0.25));
    samples.push(interpolateCoordinates(current, next, 0.5));
    samples.push(interpolateCoordinates(current, next, 0.75));
  }

  return dedupeCoordinates(samples);
}

function interpolateCoordinates(start, end, fraction) {
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction
  ];
}

function pullPointInside(polygon, coordinates, minimumDistanceKm, anchorPoint) {
  const boundaryLine = turf.lineString(polygon.geometry.coordinates[0]);
  const currentDistance = turf.pointToLineDistance(turf.point(coordinates), boundaryLine, { units: "kilometers" });

  if (currentDistance >= minimumDistanceKm) {
    return coordinates;
  }

  const lineToAnchor = turf.lineString([coordinates, anchorPoint]);
  const lineLengthKm = turf.length(lineToAnchor, { units: "kilometers" });
  if (!Number.isFinite(lineLengthKm) || lineLengthKm <= 0) {
    return coordinates;
  }

  const maxTravelFraction = 0.55;
  let fallback = coordinates;
  let bestDistance = currentDistance;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const fraction = (maxTravelFraction * attempt) / 12;
    const candidate = turf.along(lineToAnchor, lineLengthKm * fraction, { units: "kilometers" }).geometry.coordinates;
    const inside = turf.booleanPointInPolygon(turf.point(candidate), polygon, { ignoreBoundary: false });
    if (!inside) {
      continue;
    }

    const candidateDistance = turf.pointToLineDistance(turf.point(candidate), boundaryLine, { units: "kilometers" });
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

function movePointTowardAnchor(coordinates, anchorPoint, minimumTravelKm, travelFraction = 0.2) {
  const lineToAnchor = turf.lineString([coordinates, anchorPoint]);
  const lineLengthKm = turf.length(lineToAnchor, { units: "kilometers" });
  if (!Number.isFinite(lineLengthKm) || lineLengthKm <= 0) {
    return coordinates;
  }

  const travelKm = clamp(
    Math.max(minimumTravelKm, lineLengthKm * travelFraction),
    Math.min(0.03, lineLengthKm),
    lineLengthKm * 0.75
  );

  return turf.along(lineToAnchor, travelKm, { units: "kilometers" }).geometry.coordinates;
}

function farthestPointSampling(candidates, desiredCount, seedPoints = []) {
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
    const distance = turf.pointToLineDistance(turf.point(candidate), boundaryLine, { units: "kilometers" });
    return distance >= minimumDistanceKm;
  });
}

function dedupeCoordinates(coordinates) {
  const seen = new Set();
  return coordinates.filter((coordinate) => {
    const key = `${coordinate[0].toFixed(7)}:${coordinate[1].toFixed(7)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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

function getMinimumSpacing(areaSqKm, totalReferencePoints, terrainRule, heightRule) {
  if (areaSqKm <= 0.03) {
    return clamp(0.01 * terrainRule.spacingFactor * heightRule.spacingFactor, 0.008, 0.14);
  }

  const baseSpacingKm = Math.sqrt(areaSqKm / Math.max(totalReferencePoints, 5)) * 0.4;
  return clamp(baseSpacingKm * terrainRule.spacingFactor * heightRule.spacingFactor, 0.008, 0.2);
}

function getInsetDistance(areaSqKm, minimumSpacingKm, terrainRule, heightRule, polygonScale) {
  const areaBiasKm = Math.sqrt(Math.max(areaSqKm, 0.0001)) * 0.14;
  const densityInsetKm = minimumSpacingKm * 1.8;
  const terrainInsetKm = areaBiasKm * terrainRule.insetFactor;
  const heightInsetKm = minimumSpacingKm * (0.35 + heightRule.densityBoost * 0.4);
  const insetCapKm = Math.min(0.28, Math.max(0.03, polygonScale.minDimensionKm * 0.16));

  return clamp(
    Math.max(densityInsetKm, terrainInsetKm + heightInsetKm),
    Math.min(0.02, insetCapKm),
    insetCapKm
  );
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

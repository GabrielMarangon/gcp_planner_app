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
  const workingPolygon = buildInsetPlanningPolygon(polygon, minimumInteriorDistanceKm);
  const interiorInsetKm = clamp(
    minimumInteriorDistanceKm + minimumSpacingKm * 0.65,
    minimumInteriorDistanceKm * 1.18,
    Math.min(0.26, polygonScale.minDimensionKm * 0.24)
  );
  const interiorPolygon = buildInsetPlanningPolygon(polygon, interiorInsetKm);
  const coreInsetKm = clamp(
    interiorInsetKm + minimumSpacingKm * 0.75,
    interiorInsetKm * 1.18,
    Math.min(0.38, polygonScale.minDimensionKm * 0.34)
  );
  const corePolygon = buildInsetPlanningPolygon(polygon, coreInsetKm);
  const anchorPoint = getAnchorPoint(interiorPolygon);
  const minimumAnchorDistanceKm = clamp(
    Math.max(minimumSpacingKm * 0.72, polygonScale.minDimensionKm * 0.05),
    0.016,
    0.06
  );

  const outerRingLine = turf.lineString(workingPolygon.geometry.coordinates[0]);
  const middleRingLine = turf.lineString(interiorPolygon.geometry.coordinates[0]);
  const coreRingLine = turf.lineString(corePolygon.geometry.coordinates[0]);
  const outerRingCandidates = dedupeCoordinates(
    generateBoundaryCandidates(outerRingLine, Math.max(totalReferencePoints * 3, 24))
  );
  const middleRingCandidates = dedupeCoordinates(
    generateBoundaryCandidates(middleRingLine, Math.max(totalReferencePoints * 3, 24))
  );
  const interiorCandidates = dedupeCoordinates(
    filterByAnchorDistance(
      filterByBoundaryDistance(
        polygon,
        generateInteriorCandidates(interiorPolygon, Math.max(totalReferencePoints * 6, 42)),
        minimumInteriorDistanceKm * 0.92
      ),
      anchorPoint,
      minimumAnchorDistanceKm
    )
  );
  const coreCandidates = dedupeCoordinates(
    filterByAnchorDistance(
      filterByBoundaryDistance(
        polygon,
        generateInteriorCandidates(corePolygon, Math.max(totalReferencePoints * 5, 30)),
        minimumInteriorDistanceKm * 1.05
      ),
      anchorPoint,
      minimumAnchorDistanceKm
    )
  );
  const fallbackCandidates = dedupeCoordinates([
    ...middleRingCandidates,
    ...interiorCandidates,
    ...coreCandidates,
    ...outerRingCandidates
  ]);

  const outerRingGcpCount = getOuterRingGcpCount(gcpCount);
  const middleRingGcpCount = getMiddleRingGcpCount(gcpCount, outerRingGcpCount);
  const outerRingGcp = sampleBoundaryAnchors(outerRingLine, outerRingGcpCount, 0);
  const middleRingGcp = sampleBoundaryAnchors(middleRingLine, middleRingGcpCount, 0.5);
  let gcpCoordinates = [...outerRingGcp, ...middleRingGcp];

  if (gcpCoordinates.length < gcpCount) {
    gcpCoordinates = [
      ...gcpCoordinates,
      ...farthestPointSampling(
        filterFarFrom(fallbackCandidates, gcpCoordinates, Math.max(0.003, minimumSpacingKm * 0.58)),
        gcpCount - gcpCoordinates.length,
        gcpCoordinates
      )
    ];
  }

  gcpCoordinates = dedupeCoordinates(
    gcpCoordinates.map((coordinates) =>
      pullPointInside(polygon, coordinates, minimumInteriorDistanceKm, anchorPoint)
    )
  ).slice(0, gcpCount);

  const checkpointRingCount = getCheckpointRingCount(checkpointCount);
  const ringCheckpointCandidates = filterFarFrom(
    dedupeCoordinates([
      ...sampleBoundaryAnchors(middleRingLine, checkpointRingCount, 0.25),
      ...sampleBoundaryAnchors(coreRingLine, Math.max(0, checkpointCount - checkpointRingCount), 0.15)
    ]),
    gcpCoordinates,
    Math.max(0.003, minimumSpacingKm * 0.38)
  );

  let checkpointCoordinates = ringCheckpointCandidates.slice(0, checkpointCount);

  if (checkpointCoordinates.length < checkpointCount) {
    checkpointCoordinates = [
      ...checkpointCoordinates,
      ...farthestPointSampling(
        filterFarFrom(
          dedupeCoordinates([...coreCandidates, ...interiorCandidates, ...middleRingCandidates]),
          [...gcpCoordinates, ...checkpointCoordinates],
          Math.max(0.003, minimumSpacingKm * 0.58)
        ),
        checkpointCount - checkpointCoordinates.length,
        [...gcpCoordinates, ...checkpointCoordinates]
      )
    ];
  }

  checkpointCoordinates = dedupeCoordinates(
    checkpointCoordinates.map((coordinates) =>
      pullPointInside(polygon, coordinates, minimumInteriorDistanceKm * 1.06, anchorPoint)
    )
  );
  checkpointCoordinates = filterFarFrom(checkpointCoordinates, gcpCoordinates, 0.001);

  if (checkpointCoordinates.length < checkpointCount) {
    checkpointCoordinates = [
      ...checkpointCoordinates,
      ...farthestPointSampling(
        filterFarFrom(
          dedupeCoordinates([...coreCandidates, ...interiorCandidates, ...middleRingCandidates]),
          [...gcpCoordinates, ...checkpointCoordinates],
          Math.max(0.003, minimumSpacingKm * 0.52)
        ),
        checkpointCount - checkpointCoordinates.length,
        [...gcpCoordinates, ...checkpointCoordinates]
      )
    ];
  }

  checkpointCoordinates = dedupeCoordinates(
    checkpointCoordinates.map((coordinates) =>
      pullPointInside(polygon, coordinates, minimumInteriorDistanceKm * 1.06, anchorPoint)
    )
  )
    .filter((coordinates) =>
      gcpCoordinates.every((point) => {
        const distance = turf.distance(turf.point(coordinates), turf.point(point), {
          units: "kilometers"
        });
        return distance > 0.001;
      })
    )
    .slice(0, checkpointCount);

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
    "A distribuicao prioriza um anel externo seguro, um anel intermediario e apenas poucos pontos de preenchimento, para cobrir melhor a area sem colar no limite nem colapsar a rede no centro."
  );
  messages.push(
    "Nesta versao o relevo ainda e informado manualmente no painel e usado como proxy de variacao altimetrica. A leitura automatica de DEM ou MDT ainda nao foi integrada."
  );
  return messages;
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

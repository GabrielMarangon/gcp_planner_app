import * as turf from "@turf/turf";
import proj4 from "proj4";

export function calculateAreaStats(polygon) {
  if (!polygon) {
    return null;
  }

  const areaSqm = turf.area(polygon);
  const ring = polygon.geometry?.coordinates?.[0] || [];
  return {
    areaSqm,
    areaHa: areaSqm / 10000,
    areaSqKm: areaSqm / 1000000,
    vertexCount: Math.max(0, ring.length - 1)
  };
}

export function enrichPoints(points) {
  return points.map((point, index) => {
    const [lng, lat] = point.coordinates;
    return {
      ...point,
      id: point.id || `point-${index + 1}`,
      lat,
      lng,
      utm: latLngToUtm(lat, lng)
    };
  });
}

export function latLngToUtm(lat, lng) {
  const zone = Math.floor((lng + 180) / 6) + 1;
  const south = lat < 0;
  const utmProjection = `+proj=utm +zone=${zone} ${south ? "+south" : ""} +datum=WGS84 +units=m +no_defs`;
  const [easting, northing] = proj4("EPSG:4326", utmProjection, [lng, lat]);

  return {
    zone,
    hemisphere: south ? "S" : "N",
    easting: Number(easting.toFixed(3)),
    northing: Number(northing.toFixed(3))
  };
}

export function formatArea(areaSqm) {
  if (!Number.isFinite(areaSqm)) {
    return "--";
  }

  return `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0
  }).format(areaSqm)} m\u00b2`;
}

export function formatHectares(areaHa) {
  if (!Number.isFinite(areaHa)) {
    return "--";
  }

  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(areaHa)} ha`;
}

export function formatSquareKilometers(areaSqKm) {
  if (!Number.isFinite(areaSqKm)) {
    return "--";
  }

  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(areaSqKm)} km\u00b2`;
}

export function formatDensityPerSquareKilometer(density) {
  if (!Number.isFinite(density)) {
    return "--";
  }

  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2
  }).format(density)} pontos/km\u00b2`;
}

export function formatLatLng(lat, lng) {
  return `Lat ${lat.toFixed(6)} | Lon ${lng.toFixed(6)}`;
}

export function formatUtm(utm) {
  if (!utm) {
    return "--";
  }

  return `UTM ${utm.zone}${utm.hemisphere} | E ${utm.easting} | N ${utm.northing}`;
}

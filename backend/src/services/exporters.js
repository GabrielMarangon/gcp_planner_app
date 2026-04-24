import * as turf from "@turf/turf";
import tokml from "tokml";

export function exportGeoJson(points) {
  return turf.featureCollection(
    points.map((point) =>
      turf.point(point.coordinates, {
        id: point.id,
        label: point.label,
        type: point.type,
        latitude: point.lat,
        longitude: point.lng,
        utm_zone: point.utm?.zone,
        utm_hemisphere: point.utm?.hemisphere,
        utm_easting: point.utm?.easting,
        utm_northing: point.utm?.northing
      })
    )
  );
}

export function exportCsv(points) {
  const header = [
    "id",
    "label",
    "type",
    "latitude",
    "longitude",
    "utm_zone",
    "utm_hemisphere",
    "utm_easting",
    "utm_northing"
  ];

  const rows = points.map((point) => [
    point.id,
    point.label,
    point.type,
    point.lat,
    point.lng,
    point.utm?.zone ?? "",
    point.utm?.hemisphere ?? "",
    point.utm?.easting ?? "",
    point.utm?.northing ?? ""
  ]);

  return [header, ...rows]
    .map((row) => row.map((value) => escapeCsv(value)).join(","))
    .join("\n");
}

export function exportKml(points) {
  const geojson = exportGeoJson(points);
  return tokml(geojson, {
    name: "label",
    description: "type"
  });
}

function escapeCsv(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replaceAll("\"", "\"\"")}"`;
  }
  return stringValue;
}

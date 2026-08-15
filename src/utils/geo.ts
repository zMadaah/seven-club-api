// Espelha src/utils/geo.ts do app SevenClub (haversineDistance, isLoopClosed).
// O backend recalcula esses valores de forma independente do que o app manda
// — distância e "loop fechado" enviados pelo cliente são tratados como dica,
// nunca como verdade, já que são a base do cálculo de território.

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function totalDistance(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(points[i - 1], points[i]);
  }
  return total;
}

export function isLoopClosed(points: LatLng[], toleranceMeters = 25): boolean {
  if (points.length < 3) return false;
  return haversineDistance(points[0], points[points.length - 1]) <= toleranceMeters;
}

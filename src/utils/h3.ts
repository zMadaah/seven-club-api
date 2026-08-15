import * as h3 from 'h3-js';
import { LatLng } from './geo';

// Resolução 10 (~65m por célula) — decisão de arquitetura já tomada:
// mais simples de manter sozinho do que diff de polígonos.
export const TERRITORY_RESOLUTION = 10;

function toH3Loop(points: LatLng[]): [number, number][] {
  return points.map((p) => [p.latitude, p.longitude]);
}

export function cellsForLoop(points: LatLng[]): string[] {
  if (points.length < 3) return [];
  return h3.polygonToCells(toH3Loop(points), TERRITORY_RESOLUTION);
}

export function cellAreaM2(h3Index: string): number {
  return h3.cellArea(h3Index, 'm2');
}

export function cellCenter(h3Index: string): LatLng {
  const [latitude, longitude] = h3.cellToLatLng(h3Index);
  return { latitude, longitude };
}

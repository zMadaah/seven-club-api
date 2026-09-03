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

// Resolução bem mais fina, só pra CALCULAR a área do loop (não pra
// decidir quem é dono de qual hexágono — isso continua na resolução 10,
// TERRITORY_RESOLUTION, e não muda aqui).
//
// A área capturada era calculada somando as células de resolução 10
// (~65m de aresta) que o loop contém — pra um contorno de corrida
// (estreito, seguindo ruas, não uma forma "gorda"), isso sistematicamente
// SUBESTIMA a área real: testei com um loop de referência de ~2,1km de
// perímetro e a resolução 10 devolvia 6% a menos que a área geométrica
// real do polígono. Cheguei a tentar o modo 'containmentOverlapping' do
// H3 (conta célula com qualquer sobreposição, não só com o centro
// dentro) — mas isso SUPERESTIMA muito mais na direção contrária (+76%
// no mesmo teste), porque conta célula inteira mesmo quando só uma
// fração pequena dela está de fato dentro do loop.
//
// A resposta certa era simplesmente uma grade mais fina: resolução 13
// (~3-4m de aresta) chega a 0,02% de erro no mesmo teste — praticamente
// exata — sem o viés de nenhuma das duas direções. Ainda é rápido (a
// contagem de células sobe, mas h3-js resolve isso em milissegundos).
const AREA_CALC_RESOLUTION = 13;

export function captureAreaM2ForLoop(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const fineCells = h3.polygonToCells(toH3Loop(points), AREA_CALC_RESOLUTION);
  return fineCells.reduce((sum, cell) => sum + h3.cellArea(cell, 'm2'), 0);
}

export function cellAreaM2(h3Index: string): number {
  return h3.cellArea(h3Index, 'm2');
}

export function cellCenter(h3Index: string): LatLng {
  const [latitude, longitude] = h3.cellToLatLng(h3Index);
  return { latitude, longitude };
}

// Vértices do hexágono, prontos pra virar um Polygon no mapa — calcula
// aqui (não no client) pra não precisar do h3-js no app também, o app só
// recebe coordenadas já prontas de desenhar.
export function cellBoundary(h3Index: string): LatLng[] {
  return h3.cellToBoundary(h3Index).map(([latitude, longitude]) => ({ latitude, longitude }));
}

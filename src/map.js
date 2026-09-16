// Projeção do traçado da pista para 2D (mapa da prévia e minimapa da corrida).
// Puro — testável com `node --test`.

/**
 * Encaixa o traçado num quadrado `size`, mantendo a proporção.
 * Retorna o caminho SVG fechado e a função de projeção de mundo → mapa.
 */
export function projectTrack(points, size = 120, padding = 10) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const w = maxX - minX || 1;
  const h = maxZ - minZ || 1;
  const scale = (size - padding * 2) / Math.max(w, h);
  const offX = (size - w * scale) / 2 - minX * scale;
  // z cresce "pra frente"; no mapa desenhamos com o norte pra cima (y invertido)
  const offY = (size - h * scale) / 2 + maxZ * scale;

  const project = (x, z) => [x * scale + offX, offY - z * scale];
  const path = points.map((p, i) => {
    const [px, py] = project(p.x, p.z);
    return `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
  }).join(' ') + ' Z';

  return { size, scale, project, path };
}

/** Amostra o traçado pra um número menor de pontos (mapa não precisa de 900). */
export function outlineOf(points, count = 120) {
  const step = Math.max(1, Math.floor(points.length / count));
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push({ x: points[i].x, z: points[i].z });
  return out;
}

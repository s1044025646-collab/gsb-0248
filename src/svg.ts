import type { BoundingBox, Segment } from './turtle.js';

/**
 * 导出简单 SVG（polyline 集合）。屏幕坐标 y 向下，因此对数学坐标做 y 翻转。
 * 仅用于文件查看，不含交互/编辑能力。
 */
export function toSvg(
  segments: ReadonlyArray<Segment>,
  bounds: BoundingBox,
  padding = 10,
  stroke = '#1a1a1a',
  strokeWidth = 1,
): string {
  const w = Math.max(bounds.width, 1e-9) + padding * 2;
  const h = Math.max(bounds.height, 1e-9) + padding * 2;
  const tx = (x: number) => (x - bounds.minX + padding).toFixed(4);
  const ty = (y: number) => (bounds.maxY - y + padding).toFixed(4);

  const lines = segments
    .map(
      (s) =>
        `  <line x1="${tx(s.x1)}" y1="${ty(s.y1)}" x2="${tx(s.x2)}" y2="${ty(s.y2)}" />`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}">
  <g stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" fill="none">
${lines}
  </g>
</svg>
`;
}

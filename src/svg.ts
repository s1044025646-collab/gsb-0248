import type { GenerationResult } from './types.js';

/**
 * 把已报告的几何结果导出为简单静态 SVG（仅线段折线，无编辑/交互）。
 * y 轴翻转以匹配屏幕坐标习惯；四周留白 padding 个步长单位。
 */
export function toSvg(result: GenerationResult, opts?: { stroke?: string; strokeWidth?: number; padding?: number }): string {
  const g = result.geometry;
  if (g === null) {
    throw new Error('该报告不含几何结果，无法导出 SVG');
  }
  const stroke = opts?.stroke ?? '#1a1a1a';
  const strokeWidth = opts?.strokeWidth ?? 1;
  const padding = opts?.padding ?? Math.max(1, strokeWidth * 2);
  const { minX, minY, maxX, maxY, width, height } = g.bounds;
  const vbW = width + padding * 2;
  const vbH = height + padding * 2;
  const tx = -minX + padding;
  const ty = maxY + padding; // 翻转 y

  const lines = g.segments
    .map(
      (s) =>
        `  <line x1="${fmt(s.x1 + tx)}" y1="${fmt(-s.y1 + ty)}" x2="${fmt(s.x2 + tx)}" y2="${fmt(-s.y2 + ty)}"/>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(vbW)} ${fmt(vbH)}" width="${fmt(vbW)}" height="${fmt(vbH)}">
  <g stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" fill="none">
${lines}
  </g>
</svg>
`;
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

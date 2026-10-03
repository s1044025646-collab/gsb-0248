/** 内置示例：一个只有 F 的直角图案 + 一个带分支的树形图案。 */
export interface Example {
  key: string;
  name: string;
  axiom: string;
  rules: Array<{ symbol: string; replacement: string }>;
  params: { step: number; angleDeg: number; startHeadingDeg: number };
}

export const EXAMPLES: Example[] = [
  {
    key: 'quad',
    name: '直角图案（仅 F，Koch 式直角折线）',
    axiom: 'F',
    rules: [{ symbol: 'F', replacement: 'F+F-F-F+F' }],
    params: { step: 5, angleDeg: 90, startHeadingDeg: 0 },
  },
  {
    key: 'tree',
    name: '分支树（含 [] 栈分支）',
    axiom: 'F',
    rules: [{ symbol: 'F', replacement: 'F[+F][-F]' }],
    params: { step: 10, angleDeg: 25, startHeadingDeg: 90 },
  },
];

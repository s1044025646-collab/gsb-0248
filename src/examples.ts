import type { RuleSetInput, TurtleParams } from './types.js';

/** 示例 1：只有 F 的直角图案（二次科赫折线/类 dragon 风格的直角生长）。 */
export const RIGHT_ANGLE: RuleSetInput & { turtle: TurtleParams } = {
  name: 'right-angle',
  description: '只有 F 的直角图案：F -> F+F-F-F+F（90 度）',
  axiom: 'F+F+F+F',
  rules: { F: 'F+F-F-F+F' },
  turtle: { step: 10, angleDeg: 90, initialAngleDeg: 0 },
};

/** 示例 2：带分支的树（经典二维分支树）。 */
export const BRANCH_TREE: RuleSetInput & { turtle: TurtleParams } = {
  name: 'branch-tree',
  description: '带分支的二维树：F -> FF，X -> F+[[X]-X]-F[-FX]+X（25 度）',
  axiom: 'X',
  rules: {
    F: 'FF',
    X: 'F+[[X]-X]-F[-FX]+X',
  },
  turtle: { step: 4, angleDeg: 25, initialAngleDeg: 90 },
};

export const EXAMPLES = [RIGHT_ANGLE, BRANCH_TREE];

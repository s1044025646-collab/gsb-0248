# 确定性 L 系统改写与海龟线段生成后端

纯后端（HTTP API + CLI）的离线 L 系统服务：把初始字符串（公理）与逐符号的
**确定性、无上下文**替换规则，改写成多代字符串，并把选定代数解释为二维海龟线段，
可保存报告、导出 SVG。使用 TypeScript + Node.js 内置 `node:sqlite`，
**无第三方运行时依赖、无原生编译、不需要 Docker/WSL/网络**。

## 适用范围与明确限制

- 只支持确定性、无上下文规则；**不支持**概率规则、参数公式、上下文相关规则。
- 符号限定为**单个 ASCII 字符**（0x20–0x7E）；每个符号最多一条规则。
- 无规则的符号原样保留；规则值为**空串**表示删除该符号。
- 每一代**同时（并行）替换**：本代新生成的字符不会在同一轮再次套用规则；
  规则在对象中的书写顺序不影响结果。
- 第 0 代返回公理本身。

公开资源限制（触限时返回明确状态，绝不出产截断结果）：

| 限制 | 默认值 | 环境变量覆盖 |
| --- | --- | --- |
| 最大代数 | 12 | `LSYSTEM_MAX_GENERATIONS` |
| 单代最大符号数 | 1,000,000 | `LSYSTEM_MAX_SYMBOLS` |
| 几何最大线段数 | 100,000 | `LSYSTEM_MAX_SEGMENTS` |

- 预计算下一代长度，若将超过符号上限：状态 `symbol_limit`，停在最后一个**完整**代，
  返回的字符串完整且未截断。
- 解释时线段数将超上限：状态 `segment_limit`，`geometry` 为 `null`，
  `geometryRejected=true`；字符串仍完整。
- 最终字符串括号不平衡（缺 `]`、多余 `]`、先 `]` 后 `[`）时**拒绝**生成几何。

## 海龟解释约定

- 坐标：笛卡尔平面，**x 向右为正、y 向上为正**；长度单位等于步长单位。
- 角度单位：**度**。初始朝向 `initialAngleDeg` 默认 0°（朝 +x/东）；
  90° 朝北（+y）。`+` 逆时针旋转，`-` 顺时针旋转。
- 指令：
  - `F` 前进 `step` 并画一条线段
  - `f` 前进 `step`，**不画线**（抬笔移动，仍计入包围盒）
  - `+` / `-` 转 `angleDeg`
  - `[` 保存当前位置与朝向到栈
  - `]` 恢复栈顶位置与朝向；恢复本身**不画连接线**
  - 其他符号（如 `X`）在几何阶段忽略，仅参与改写
- 输出：有序线段列表、`segmentCount`、`totalLength`、包围盒
  （minX/minY/maxX/maxY/width/height）。

## 数据与版本化

- SQLite 文件默认在项目内 `data/lsystem.db`（自动创建；可用 `--db` 或
  `LSYSTEM_DB` 覆盖）。
- 规则集每次成功更新都会新增一个**不可变版本**；报告（reports 表，只增不改）
  保存当时的规则版本、公理/规则快照、海龟参数与完整结果 JSON。
- 因此**修改规则不会影响任何旧报告**；非法更新在校验阶段失败，不写新版本、
  不触碰已保存结果。也可以用 `version` 按旧版本规则生成。

## 环境要求

- Node.js >= 22.5（开发与验证使用 Node v25.5.0；依赖内置 `node:sqlite`）。
- 仅开发依赖：`typescript`、`@types/node`。

## 构建、测试、启动、演示

```powershell
npm install        # 安装开发依赖
npm run build      # tsc 编译到 build/
npm test           # 构建并运行 node:test（37 个用例）
npm start          # 构建并启动 HTTP API（默认自动选择空闲端口）
npm run demo       # 端到端演示：播种示例、生成、导出、重启一致、旧报告不变
```

启动后终端会打印实际端口，例如 `http://127.0.0.1:53124`。
指定端口：`node build/src/cli/index.js serve --port 8080`
（端口被占用时自动回退到系统分配的空闲端口）。

## CLI

全局选项：`--db <path>` 指定数据库文件。

```powershell
# 规则导入（行内 JSON 或文件）
node build/src/cli/index.js import --name koch --axiom F --rules '{"F":"F+F-F"}'
node build/src/cli/index.js import --file examples/branch-tree.json
node build/src/cli/index.js list
node build/src/cli/index.js show 1
node build/src/cli/index.js show 1 --version 1
node build/src/cli/index.js update 1 --name koch --axiom F --rules '{"F":"FF"}'

# 按代生成（同时输出各代长度、字符片段、线段数、包围盒）
node build/src/cli/index.js generate 1 --generations 3 --step 10 --angle 90
node build/src/cli/index.js gen 1 -n 2 --step 4 --angle 25 --initial-angle 90 --no-save
node build/src/cli/index.js lengths 1 --generations 5

# 报告与导出
node build/src/cli/index.js reports
node build/src/cli/index.js report 2 --full
node build/src/cli/index.js export 2 --out data/tree.svg

node build/src/cli/index.js seed     # 写入两个内置示例
node build/src/cli/index.js limits   # 查看公开限制
node build/src/cli/index.js demo
```

## HTTP API

所有请求/响应均为 JSON（SVG 端点除外）。错误体：
`{ "code": "ERROR_CODE", "message": "...", "details"?: ... }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/limits` | 公开限制与坐标/角度约定 |
| POST | `/api/rulesets` | 新建规则集（版本 1） |
| GET | `/api/rulesets` | 列出规则集 |
| GET | `/api/rulesets/:id?version=N` | 查看规则集（可指定历史版本） |
| PUT | `/api/rulesets/:id` | 更新规则集（成功才追加新版本） |
| POST | `/api/rulesets/:id/generate` | 按代生成，可选海龟几何并保存报告 |
| GET | `/api/reports?rulesetId=` | 报告列表 |
| GET | `/api/reports/:id` | 读取完整报告（含结果快照） |
| GET | `/api/reports/:id/svg` | 导出静态 SVG |

错误码：`VALIDATION_ERROR`(400)、`NOT_FOUND`(404)、`CONFLICT`(409)、
`UNBALANCED_BRACKETS`(422)、`RESOURCE_LIMIT`(422)、`INTERNAL_ERROR`(500)。
触限不是 HTTP 错误（请求本身合法），而是 HTTP 200 结果体内 `status=symbol_limit|segment_limit`。

生成请求示例：

```json
POST /api/rulesets/1/generate
{
  "generations": 4,
  "version": 1,
  "save": true,
  "turtle": { "step": 4, "angleDeg": 25, "initialAngleDeg": 90, "initialX": 0, "initialY": 0 }
}
```

规则集对象格式：

```json
{ "name": "koch", "axiom": "F", "rules": { "F": "F+F-F" }, "description": "可选" }
```

## 内置示例

- `right-angle`：只有 `F` 的直角图案，公理 `F+F+F+F`，`F -> F+F-F-F+F`，转角 90°。
- `branch-tree`：带嵌套分支的树，公理 `X`，
  `F -> FF`、`X -> F+[[X]-X]-F[-FX]+X`，转角 25°、初始朝上。

`npm run demo` 会打印两者的字符片段、各代长度、线段数量与包围盒，
导出 `report-<id>.svg`，并演示「重启后同一结果」与「改规则后旧报告不变」。

## 测试

- 互相替换规则 `A->B, B->A`：断言 `AB -> BA`（并行），与递归替换 `AA` 明确区分；
  规则顺序无关；小代数用独立参考替换器（split/join 实现）交叉核对。
- 空公理、空替换（删除）、未定义符号保留、第 0 代。
- 嵌套分支栈恢复、`f` 不画线、旋转与包围盒用手算坐标核对（容差 1e-9）。
- 括号不平衡拒绝、参数校验。
- 符号预算（`symbol_limit`）与线段预算（`segment_limit`）不出截断结果。
- SQLite：非法更新不覆盖、版本化旧报告不变、按旧版本生成、重启后报告字节级一致。
- HTTP API 冒烟（创建/生成/报告/SVG/400/404/422）。

## 项目结构

```
src/
  lsystem.ts    并行替换、有界多代生成、括号检查
  turtle.ts     海龟解释（线段、总长、包围盒）
  types.ts      类型、限制常量（支持环境变量覆盖）
  errors.ts     错误码与 AppError
  store.ts      SQLite：规则集版本 + 只增报告快照
  service.ts    生成/几何/报告编排
  svg.ts        简单静态 SVG 导出
  server.ts     裸 node:http 的 JSON API（零框架）
  examples.ts   两个内置示例
  cli/index.ts  CLI 入口（serve/demo/import/generate/...）
test/           node:test 用例
examples/       规则集 JSON 样例
data/           SQLite 与导出文件（自动创建）
```

# L 系统改写与海龟线段生成后端

离线、确定性的 L 系统（Lindenmayer system）生成服务：把初始字符串（公理）和逐符号替换规则
展开为多代字符串，并用海龟绘图解释成二维线段。只提供 **HTTP API 与命令行（CLI）**，
不含网页或图形编辑器。

- 运行时：Node.js（建议 ≥ 22.5；本机实测 v25）+ TypeScript
- 存储：内置 `node:sqlite`（`DatabaseSync`），**无需任何第三方数据库**
- 平台：Windows 本地直接运行，不依赖 Docker / WSL / 外部在线服务

## 语义约定

### 改写规则

- 确定性、无上下文：每个符号**至多一条**规则；规则重复保存时报 `DUPLICATE_RULE`。
- 符号限定为**单个可打印 ASCII 字符**（码位 33–126）。
- 无规则的符号原样保留；**空替换串表示删除**该符号。
- **每一代同时改写**：实现上只对上一代字符串扫描一次、逐字符查表一次，
  本代新产生的字符绝不会在同一轮被再次替换（规则顺序不影响结果）。
- 第 0 代返回公理本身。

### 海龟几何

- 平面直角坐标：`x` 向右为正，`y` 向上为正。
- 角度单位为**度**。`heading=0` 指向 +x，正角度逆时针；`+` 左转、`-` 右转。
- `F` 前进并画线；`f` 前进不画线（但计入包围盒）；`[` 压栈保存位置与朝向；
  `]` 弹栈恢复，恢复动作本身**不画连接线**；其余符号无几何动作。
- 初始位置 `(startX, startY)` 默认 `(0,0)`，初始朝向默认 `90`（朝上）。
- 字符串方括号不平衡（未闭合或多余的 `]`）一律拒绝几何生成，返回 `UNBALANCED_BRACKETS`。

### 资源限制（公开常量，见 `GET /api/limits` 或 `lsys limits`）

| 限制 | 默认值 | 超限行为 |
| --- | --- | --- |
| 最大代数 `maxGeneration` | 20 | 返回 `INVALID_PARAM`，不生成 |
| 单代符号数 `maxSymbols` | 2,000,000 | 状态 `limit_symbols`；截断代不解释几何、不标为完整 |
| 线段数 `maxSegments` | 500,000 | 几何状态 `limit_segments`，保留预算内线段 |

每次生成报告都列出各代长度与最终状态；截断字符串永远不会被标记为完整生成。

### 持久化与版本

- 规则集保存在 SQLite 表 `rulesets`，更新即 `version + 1`。
- 解释并持久化后写入 `reports` 表，payload 是**完整快照**
  （公理、规则、参数、各代长度、状态、全部线段、包围盒、最终字符串）。
  因此之后修改规则不会影响旧报告；服务重启后仍可读取并导出完全相同的 SVG。
- 校验失败的输入不会写库，不覆盖已保存的成功结果。

## 构建与测试

```powershell
npm install
npm run build     # tsc -> dist/
npm test          # node:test，21 个用例
npm run demo      # 端到端演示：两示例、重启一致性、SVG 导出
```

## 启动 HTTP 服务

```powershell
npm start
# 或指定端口 / 数据目录
$env:LSYS_PORT="8080"; $env:LSYS_DATA_DIR="./data"; node dist/server.js
```

不指定 `LSYS_PORT` 或设为 `0` 时自动选择一个**空闲端口**（先绑定 0 再关闭取得端口），
启动日志会打印实际地址。数据文件默认在项目内 `data/lsystem.db`。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/api/limits` | 公开资源上限 |
| POST | `/api/rulesets` | 保存规则集 |
| GET | `/api/rulesets` | 列表 |
| GET | `/api/rulesets/:id` | 详情（含规则） |
| PUT | `/api/rulesets/:id` | 修改（版本自增，旧报告不变） |
| POST | `/api/preview` | 不落库按代生成预览 |
| POST | `/api/interpret` | 解释为线段；`persist:true` 时保存报告 |
| GET | `/api/reports?rulesetId=` | 报告列表 |
| GET | `/api/reports/:id` | 报告快照详情 |
| GET | `/api/reports/:id/svg` | 直接返回 SVG |
| POST | `/api/reports/:id/svg` | body `{"path":"data/x.svg"}` 导出到文件 |

错误响应统一形如 `{"ok":false,"error":{"code":"...","message":"..."}}`，
错误码：`INVALID_SYMBOL`、`DUPLICATE_RULE`、`INVALID_PARAM`、`INVALID_RULESET`、
`NOT_FOUND`、`GENERATION_LIMIT`、`UNBALANCED_BRACKETS`（后两者 HTTP 422，参数类 400，未找到 404）。

示例：

```powershell
$body = '{"name":"tree","axiom":"F","rules":[{"symbol":"F","replacement":"F[+F][-F]"}]}'
Invoke-RestMethod http://127.0.0.1:8080/api/rulesets -Method Post -ContentType 'application/json' -Body $body
Invoke-RestMethod http://127.0.0.1:8080/api/interpret -Method Post -ContentType 'application/json' `
  -Body '{"rulesetId":1,"generation":3,"params":{"step":10,"angleDeg":25,"startHeadingDeg":90},"persist":true}'
Invoke-WebRequest http://127.0.0.1:8080/api/reports/1/svg -OutFile data/tree.svg
```

## CLI

```powershell
node dist/cli.js preview --axiom AB --rules "A=AB;B=A" --generation 4
node dist/cli.js ruleset-add --name tree --axiom F --rules "F=F[+F]F"
node dist/cli.js ruleset-list
node dist/cli.js ruleset-update 1 --rules "F=FF"
node dist/cli.js generate 1 --generation 3 --step 10 --angle 25 --persist
node dist/cli.js report-list
node dist/cli.js report 1
node dist/cli.js export 1 --out data/tree.svg
node dist/cli.js limits
```

- `--rules` 简写用分号分隔：`"F=F+F;X="`（`X=` 表示删除 X）；
  也接受 JSON 数组 `[{"symbol":"F","replacement":"F+F"}]`。
- 终端输出包含各代长度、状态、字符片段（前 200 字）、线段数、总长度与包围盒。

## 内置示例

| key | 说明 | 公理 / 规则 | 海龟参数 |
| --- | --- | --- | --- |
| `quad` | 只有 F 的直角折线 | `F`，`F -> F+F-F-F+F` | step 5，转角 90° |
| `tree` | 带 `[]` 分支的树 | `F`，`F -> F[+F][-F]` | step 10，转角 25°，初始朝上 |

`npm run demo` 会把两者各生成到第 3 代，打印片段、线段数与包围盒，导出树的 SVG，
随后修改规则、关闭并重新打开数据库，验证旧报告快照与 SVG 完全不变。

## 测试覆盖

- 互相替换规则（`A<->B`）区分同时改写与递归连锁替换
- 空初始串、空替换（删除）、未定义符号保留、零代返回公理
- 规则顺序无关、与独立参考替换器逐字符核对
- 嵌套分支栈恢复、`f` 移动不画线、手算旋转与包围盒（容差 1e-9）
- 括号不平衡（未闭合 / 多余右括号）、线段预算不足、符号预算不足
- 重启后同一报告导出同一 SVG；规则升级后旧报告保持 v1 快照；错误输入不写库

## 已知限制与假设

- 仅支持确定性、无上下文规则；不支持概率、参数公式、上下文敏感规则。
- 长度按 JS 字符串（UTF-16 码元）计；符号限定 ASCII，因此码元数即符号数。
- 达符号上限的那一代不落完整串（保留最后一个完整代并给出超限代的实际长度），
  以避免把截断结果误用为几何输入。
- SVG 仅为静态查看用途（`<line>` 集合 + y 轴翻转），不含编辑能力。

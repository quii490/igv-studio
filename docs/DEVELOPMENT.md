> Developer documentation: build, tests and validation notes. For what the app is and how to use it, see the [README](../README.md).

# IGV Single SVG Studio

> `docs/validation/` 下的测试输出是本地生成的，不入库（见 `.gitignore`）；已提交的报告在 `docs/reports/`。

单张 IGV 导出 SVG → 论文级矢量图的浏览器编辑器。**不拼版**、不重绘信号、不需要 bigWig、不需要 Illustrator 才能运行。

## 怎么打开（先看这里）

| 你想做什么 | 用哪个文件 | 说明 |
|---|---|---|
| **自己用 / 给导师、同学用** | `dist/IGV-Studio.html`（约 230 KB，单文件） | **双击**即可在 Chrome / Edge 打开，无需装 Node、无需服务器。也可用 `scripts/build-single.mjs` 重新生成 |
| 改代码 | `index.html` + `npm run dev` | ⚠️ **`index.html` 不能双击**：它只是 Vite 的入口，里面指向 `/src/main.tsx`，必须由 dev server 提供 |

> `index.html` 双击后白屏/报错是正常现象，不是坏了——请用 `dist/IGV-Studio.html`。

## 三步用法

1. IGV Desktop：调好位点与 y 轴 → `File > Save SVG Image`（或 batch 里 `snapshot xxx.svg`）。
2. 双击 `IGV-Studio.html` → 把 SVG 拖进左侧虚线框。
3. 左侧改裁剪/字号/描边/版式，右侧改轨道名/颜色/顺序 → 点「导出 SVG」→ 在 Illustrator 里拼 Figure。


```
IGV Desktop ──snapshot xxx.svg──▶ 本工具 ──导出 SVG──▶ Illustrator（由用户自行拼 Figure）
```

## 三种打开方式

| 你是 | 怎么做 |
|---|---|
| **只想用，不装任何东西** | 双击 **`IGV-Single-SVG-Studio.html`**（项目根目录，172 KB 单文件，Chrome/Edge 打开即可） |
| 开发者，想改代码/热更新 | `npm install && npm run dev` → http://localhost:5199 |
| 想重新打包单文件 | `npm install && npm run standalone` → `dist/IGV-Single-SVG-Studio.html` |

> **根目录的 `index.html` 双击打不开是正常的**：它只是 Vite 入口（`<script type="module" src="/src/main.tsx">`），浏览器不能直接执行 `.tsx`，也不能在 `file://` 下加载外部模块。请用上面三种方式之一。

详细操作（含 IGV 导出步骤、每个参数在哪、常见报错）见 **[使用说明.md](使用说明.md)**。

```bash
npm run build    # tsc --noEmit + vite build
npm run test     # 科学性验收 T1–T14（headless Chrome）
npm run test:e2e # 交互 E2E：选中/拖动/改字号/缩放/平移/隐藏/撤销/导出（13 项）
npm run audit:perf  # 真实时间性能（CDP）
npm run audit:download # 真实浏览器下载测试（http + file://）
npm run poc:svgedit  # SVG-Edit 集成 PoC（真实夹具往返）
npm run test:pdf # T8：导出 SVG → PDF，文字是否可选中
```

需要 Node ≥ 18（仅开发和测试需要；单纯使用不需要）；测试脚本用本机 Chrome（路径写死在 `scripts/*.mjs`，非 macOS 需改）。

快速试玩（仅开发模式）：`http://localhost:5199/#fixture=panel_igv2198.svg`。

## 支持哪些输入

| 输入 | 支持 | 说明 |
|---|---|---|
| IGV 导出的 `.svg` | ✅ 完整 | 解析 → 编辑 → 导出 |
| IGV Session `.xml` | ⚠️ 只读配置 | 读出 genome / locus / 轨道名 / 颜色 / y 范围，并可**生成 IGV batch 脚本** |
| 只有 `.xml` 没有 `.svg` | ❌ | session 不含几何，也无法访问你机器上的 bigWig；渲染必须由 IGV 完成 |

`XML → SVG` 的路径是：**本工具生成 batch 脚本 → IGV 执行 `snapshot` → 把 SVG 拖回来**。浏览器里重画信号会违反"不重绘数据"的原则，因此不做。

## 使用流程

1. 拖入 IGV 2.19.8 `snapshot` 出的 `.svg`（或点「选择 SVG 文件」）。
2. 左侧调裁剪、版式、字号、描边；右侧改轨道名/颜色/顺序/显隐/ymax。
3. 中间实时预览，可缩放；左右两条蓝色手柄拖动裁剪基因组区间。
4. 「导出 SVG」得到独立文件；「导出配置 JSON」保存样式，下次「导入配置」复用。
5. 需要多张图时，逐个导入导出即可（本工具刻意不做多 Panel 拼版）。

## 架构

```
SVG 文本 ─▶ stripDoctype ─▶ DOMParser ─▶ IGV 适配器 ─▶ Panel IR ─▶ 编辑引擎 ─▶ SVG 字符串
             (parser.ts)              (parser.ts)     (types.ts)   (engine.ts)
```

- **Panel IR**（`src/core/types.ts`）：`canvas / locus / calibration / name_gutter / ideogram / ruler / tracks / genes` + 诊断字段。
- **解析器**（`parser.ts`）：不依赖正则删文字，也不按颜色猜轨道；全部基于几何与文本聚类，并在无法标定时把错误抛给 UI。
- **编辑引擎**（`engine.ts`）：唯一几何常数是 `k = 数据区 pt / 裁剪跨度 units`；字号、描边、间距都换算成 `pt / k` 的 user units，因此**字体尺寸与几何缩放彻底解耦**，不是把整张图缩小。
- **导出**：信号对象仅平移（每轨对齐基线）+ `clipPath` 裁剪，不重绘、不缩放横向；标签/标尺/行距由模板重建。

### 坐标系与单位

| 概念 | 说明 |
|---|---|
| 源 SVG 单位 | IGV 输出的 user unit（≈px） |
| `k` | 1 user unit 对应的 pt 数，`k = dataWidthPt / cropUnits` |
| 导出字号 | `font-size = pt / k` user units ⇒ 渲染后正好是配置的 pt |
| 画布 | `width = gutterPt + dataWidthPt`，`viewBox` 用 user units |

## 自动识别（真实 2.19.8 样本实测）

| 项 | 结果 |
|---|---|
| DOCTYPE | IGV 必带，解析前剥离（`<!ENTITY>` 仍拒收） |
| 画布 | 无 `viewBox`/`width`/`height` → 由几何 bbox 推断 |
| 名称栏 | 172 px（数据面板左边界） |
| 数据区 | 962 px |
| 轨道 | 3 条，节距 41 px（细条 y 聚类） |
| 标尺 | 3 个刻度 → 28.6123 bp/px，三点残差 0.50 px |
| locus | `chr14:63,120,461-63,147,923` → 独立算出 28.5468 bp/px |
| 双源交叉校验 | 相差 **−0.39 px**（>1 px 时拒绝导出） |

**裁剪不使用 ink bounding box**：坐标由 `locus × 面板宽` 与 `标尺刻度` 两路独立推算，互相校验。

## 验收结果

`npm run test`（真实 13/13 PASS，详见 `docs/validation/acceptance.md`）：

| 编号 | 断言 | 实测 |
|---|---|---|
| T1 | 无位图/script/foreignObject | 0 |
| T2 | 轨道名/基因名/刻度/**范围标签**保留 | 11 个文本，缺失 0 |
| T3 | 字号 ∈ {4,5,6,10} pt | 唯一值 {4,5,6} |
| T4a | 解析器选中对象守恒 | 7675 → 7675 |
| T4b | **独立**扫描原始 SVG 的几何指纹 | 4,864 个源对象，missing 0 |
| T5 | 数据区左边界误差 ≤0.5 px | 0.00001 px |
| T6 | 标签右端误差 ≤0.2 pt | 0.00004 pt |
| T7 | 轨道节距误差 ≤0.2 pt | 8.12 / 8.12，误差 0.00008 pt |
| T9 | **裁剪不改变峰高** | 全区间与 25% 裁剪均为 3.3907 pt（k 不变） |
| T10 | 轨道颜色真正生效 | 继承 fill = `#C01834` |
| T11 | 源 y 轴范围被解析 | `[316, 294, 274]` |
| T12 | 校准不一致阻止导出 | 篡改 crossCheck=5 → 拒绝 |

`npm run test:pdf`：PDF 中提取到 `chr14 63,130 kb 63,140 kb IgG-rep1 KDM5A-rep1 KDM5B-rep1 Ctsb Fdft1` → **T8 PASS**（文字可选中）。

## 审计与选型（v2.1）

- **性能**：拖动从 68 ms/帧（15 fps）降到 **15.3 ms/帧**（60 fps）。根因是每次 pointermove 重建 1.66 MB SVG 并整体替换 innerHTML；改为拖动期间只写 `transform`，`pointerup` 提交一次。
- **下载**：用 CDP 真实鼠标事件验证，http 与 `file://` 均能下载（1,665,149 B）。失败的真实原因是**按钮 disabled 时静默无反馈**与导出异常被吞，已加提示与 try/catch。
- **选型**：实测 SVG-Edit `@svgedit/svgcanvas` 7.4.2（MIT）在真实 735 KB 夹具上 open 203–248 ms、export 76 ms，几何 4,917/4,917 零漂移、文字仍是 text；但它的"万物可编辑 + 画布 zoom"模型与我们的"信号锁定 + 基因组坐标"冲突。**结论：不重写，不采用其编辑器主体**；只在需要富文本时考虑把注解层托管给它。全文见 [docs/validation/tool_selection.md](docs/validation/tool_selection.md)。

## Tauri 2 PoC（分支 `tauri-poc`）

同一套 React + 同一份 SVG 引擎，换掉桌面容器做的可行性验证。详见 [docs/validation/tauri_poc.md](docs/validation/tauri_poc.md)。

| | Electron 2.0.0 | Tauri 2.12 |
|---|---|---|
| 导出 SVG（同机同文件） | 1,665,271 B | **1,665,271 B，SHA-256 完全一致** |
| `.app` / DMG | 417 MB / 180 MB | **8.4 MB / 2.2 MB** |
| 冷启动中位数（3 次） | 264 ms | 293 ms |
| 每帧同步工作 p95（缩放/平移） | 2.3 / 1.4 ms | 1.0 / 1.0 ms |

产物：`release/tauri/IGV-Studio-tauri-arm64.dmg`、`IGV-Studio-tauri-x64.dmg`（均为 ad-hoc 签名，非公证）。Windows 包未构建（本机无 MSVC），命令见报告。

前端不是复制一份：`src/platform/bridge.ts` 做运行时抽象，Tauri 的 `frontendDist` 直接指向同一份 `dist/`。

## 分发说明（先看这条）

`release/IGV Studio-2.0.0-universal.dmg`（macOS，Intel + Apple Silicon）与 `release/IGV Studio Setup 2.0.0.exe`（Windows x64）**未做代码签名/公证**：macOS 首次启动需要在「系统设置 → 隐私与安全性」里点“仍要打开”，Windows 首次运行需要「更多信息 → 仍要运行」。想做到零提示，需要 Apple Developer ID（重新签名 + 公证）和 Windows 代码签名证书。完整审计见 [docs/validation/audit_distribution.md](docs/validation/audit_distribution.md)。

## v2：Electron 桌面应用 + 全窗口拖放 + 批量导入导出

见 [docs/validation/v2_upgrade.md](docs/validation/v2_upgrade.md)。

```bash
npm run build && npm run standalone   # 网页产物
npm run dist:mac                      # macOS .app + .dmg（release/）
npm run dist:win                      # Windows NSIS 安装包（需在可运行 electron-builder 的环境）
```

- **真桌面应用**：Electron 33，`contextIsolation/sandbox` 全开，preload 白名单 IPC；单实例、原生菜单（⌘O 打开、⌘E 导出 SVG、⇧⌘E 导出 ZIP）、原生保存对话框返回真实路径。
- **全窗口拖放**：window 级 dragenter/dragover/dragleave/drop + 计数器，整窗蒙层提示；任意位置拖入 SVG / Session XML，多文件一次导入，非 SVG 明确提示且不跳转。
- **多文档**：`documents[] + activeDocumentId`，每张图独立 IR/状态/历史/选区；列表显示轨道数、大小、标定状态，可切换与移除。
- **批量导出**：fflate 打 ZIP（每张图独立 SVG + `export_manifest.json`），重名自动编号。
- **类别偏移**：每个类别（轨道名/范围/刻度/基因名/染色体）可统一设 dx/dy、字号、对齐、显隐，单对象覆盖优先。
- **导出校验**：批量导出时逐张重新解析比对信号对象数，结果写入 manifest。
- **分层渲染**：信号层一次挂载；改文字/字号只 patch 注释层（实测 `buildSVG` 调用次数不变、信号 rect 节点身份不变），导出时再按完整状态重建。
- **性能**：手势期 `buildSVG` 调用次数 0；每帧同步工作 zoom p95 1.4 ms、pan p95 1.3 ms；标尺改为只重绘刻度线（5 个节点）。

## 桌面 App（v1 方案，已被 Electron 取代）

```bash
npm run standalone && npm run app    # 产物在 release/（dist/ 每次 build 会被清空）
```

| 产物 | 用途 |
|---|---|
| `release/IGV Studio.app` | macOS 双击即用：独立窗口、无地址栏，内置 app.html 与图标 |
| `release/IGV-Studio-mac.zip` | 分发用（208 KB） |
| `release/IGV-Studio-Windows/` + `.zip` | Windows：双击 `Start IGV Studio.cmd` |
| `release/IGV-Studio-README.txt` | 安装与 Gatekeeper 说明 |

App 本身只是"用 Chrome/Edge 的 app 模式打开内置 HTML"，因此 **不需要 Node、不需要联网、不需要服务器**；渲染与导出仍全部在本地完成。首次打开 macOS 会拦截未签名应用：右键 → 打开，或 `xattr -dr com.apple.quarantine`。

## v5：画板不再随缩放变形

"抖"的根因不是重绘，而是 `widthPt = gutter + crop×k`：裁剪一变画板就变宽变高、flex 居中又挪位（实测 741→694→654，左边界 420→443→463）。

现改为 **pt 根坐标系 + 固定画板**：`viewBox="0 0 W H"`（1 unit = 1 pt），信号层用 `translate(dataLeft, baseline) scale(sx, sy) translate(-x0, -y1)`，`sy` 恒定所以峰高永远不变。实测 6 步缩放下画板宽 926、高 471、左边界 327 **全部恒定**；预览只改 transform，15,387 个节点不变。

详见 [docs/validation/jitter_root_cause.md](docs/validation/jitter_root_cause.md)。

## v4：稳定画布 / 类别批量 / FigureR1 实测样式

详见 [docs/validation/v4_canvas_and_style.md](docs/validation/v4_canvas_and_style.md)。

- **缩放不再重建 DOM**：滚轮/平移/裁剪拖动只改 live SVG 的 `viewBox`，180 ms 防抖后提交。实测连续 10 次滚轮，同一 SVG 元素、15,387 节点不变（`docs/validation/zoom_stability.json`）。
- **光标由工具决定**，不再随命中元素跳变；四角手柄方向区分 `nwse/nesw`。
- **选框测量移到 useLayoutEffect**，不在 render 中读布局。
- **按类别批量**：轨道名/范围/刻度/基因名/染色体各自设字号、对齐、显示；样式链为 预设 → 类别 → 对象覆盖；支持「选择所有同类」。
- **FigureR1 实测值修正**：KDM5B `#4C4C9E`、基因模型 `#132D8A`、六个实测数据区宽、「无遮挡 / 精确复刻」两套模板。

## v3：按独立审计修的 8 个缺陷

完整记录见 [docs/validation/stability_v3.md](docs/validation/stability_v3.md)。要点：

- **坐标统一**：`px → pt → user units` 一条通路；拖动预览与提交不再各算一套（真实鼠标 18 px 拖动 → 127 units，误差 1.2%）。
- **平移不再重建**：只挪渲染层，`pointerup` 一次提交（15.0 ms/帧）。
- **裁剪**改为以按下点为一端，补 Pointer Capture。
- **手柄字号**用 `ptPerUnit`，不再是 px。
- **无 locus 也能用**：新增 **visual-only** 模式（只排版、无基因组裁剪语义），不再"没标定就完全不能导出"。
- **多选批量改样式**一次更新、一条撤销。
- **预设色补全**，取色器显示的是信号真实颜色。
- **导出的 SVG 可再次打开**：根节点写 `data-locus`、基因层用 `<g id="genes">`，重新导入后仍是 3 轨且标定 `both`。

同时纠正上一版报错的数字：完整 `buildSVG` 是 **27.9 ms**（不是 0.4 ms，那是复用缓存字符串）。

## v2.2：导不出来的问题 + 借鉴 SVG-Edit 的交互

**「导出 SVG 按不了」的根因**：标定门槛是"必须双源交叉验证"，单源（只有 locus 或只有标尺）直接禁用导出，且没有补救入口。已改为：

- 只有**两套标定互相冲突**（起点差 >1 px / 比例尺差 >0.5% / 刻度残差 >1 px）才禁用；
- 单源或完全识别不到时，左侧出现 **「2b · 手动标定」**：填 `chr:start-end`，用"数据区宽度"建标定，导出标为"未交叉验证"；
- 禁用时按钮 `title` 与状态栏都会写明原因，不再静默。

实测（`docs/validation/manual_calibration.json`）：把 SVG 里所有 `<text>` 删掉 → 按钮禁用且给出原因 → 手填区间 → 按钮可用 → 真实鼠标点击下载成功 1,664,504 B。

**借鉴 SVG-Edit 的交互细节**：

- 选中框四角**手柄**，拖动按距离比例改字号（不是缩放 transform），拖动中实时显示 pt；
- 拖动时**对齐吸附**：靠近其他对象中心 ±6 px 自动吸附并画洋红参考线；
- 拖动中 HUD 显示 `Δx / Δy (pt)`；
- 一次拖动/一次改字号 = 一条撤销记录（预览走 DOM，提交在 pointerup）。

## 交互能力（v2）

文字/范围/基因名/chr 都是**可选中对象**：点击出选框、拖动摆位、双击改字、方向键微调、Delete 隐藏、Shift 多选、空白框选；工具分「选择 / 平移 / 裁剪」，滚轮以鼠标为中心缩放基因组窗口。详见 [docs/validation/editor_v2.md](docs/validation/editor_v2.md)。

## 已知限制（不要当成已完成）

1. **只验证了 IGV 2.19.8 这一种输出结构。** 其他版本（3.0 beta、igv.js）未测，缺适配器；解析失败会在状态栏报错而不是猜。
2. **基因模型底部偏紧**：基因名贴着画布下缘，多行注释可能被裁。
3. **裁剪手柄**只能拖左右边界，且点数很少时步进较粗；没有键盘微调。
4. **没有拖拽平移**，只有缩放按钮与滚动条。
5. **批量**只是"逐个导入导出"，没有队列/批量 ZIP（按本轮需求，明确不做多 Panel 拼版）。
6. **Illustrator 兼容性未实测**：只保证输出是原生 SVG（无位图、文字仍是 `<text>`、字体 Arial），未在 AI 里打开验证。
7. **yMax 只读**：想换 y 轴必须回 IGV 重导；工具不提供"只改标签"的能力。
8. **裁剪后画布变窄**：为保证峰高恒定，裁剪会缩短数据区 pt 宽度，不是把区间拉伸回原宽。
9. **参数无 schema 校验**、**ideogram 不可选**、**单夹具（3 轨）**、**无交互 E2E** —— 见 `docs/validation/audit_response.md`。
10. **轨道名映射默认关闭**：不同实验室的文件命名不同，内置规则已清空；在界面「轨道名映射」里按 `pattern => label` 每行一条填写，或用 CSV/JSON 映射表覆盖。
11. 测试用 headless Chrome（未装 Playwright），交互（拖拽、点击）未做端到端自动化，只有导入→构建→导出这条链路被自动化覆盖。

## 参考样式（FigureR1.ai 实测）

| 元素 | 值 |
|---|---|
| 轨道名 / 数据范围 / 刻度 | 5 / 4 / 5 pt |
| 基因名 / 染色体 | 6 / 6 pt |
| 描边 | 0.25 pt |
| 轨道节距 | 8.12 pt |
| 数据区宽 | 101.7 pt |
| 参考色 | KDM5A `#C01834`、KDM5B `#4C4D9E`、KO `#F39619` |

预设只管**单个位点**的样式，不含 A/B 面板拼版信息。

# IGV Studio v2 — 最终验收矩阵

日期：2026-11-12 00:00 左右（本机实测）。所有数字来自真实运行；测试脚本均以 npm script 固化。

## 目标项与证据

| 目标 | 状态 | 证据 |
|---|---|---|
| 全窗口文件拖放 | ✅ | `reports/e2e_drop.json`：窗口四角+中心各拖 1 个真实 SVG → 导入 1/2/3/4/5 个文档；多文件一次拖入 +2；非 SVG 不跳转 |
| Electron 桌面应用（mac .app/.dmg） | ✅ | `release/IGV Studio-2.0.0-arm64.dmg`（94 MB）；`reports/e2e_electron.json` 在打包 App 内运行 |
| Windows 安装包 | ✅（产物）/ ⚠️（未在 Windows 运行） | `release/IGV Studio Setup 2.0.0.exe`（78 MB），NSIS x64；PE 内嵌图标 7 个尺寸 + 版本号 2.0.0.0（resedit 读回验证） |
| 分层画布：Canvas/Genome 缩放分离 | ✅ | ⌘+滚轮=画布、普通滚轮=基因组；`reports/e2e_canvas_zoom.json` 光标漂移 **0.4 px**、视口中心漂移 **0.3 px** |
| 手势期不重建 DOM | ✅ | `reports/perf_v2.json`：zoom/pan `buildsInGesture = 0`；每帧同步工作 p95 **1.3 ms** |
| 标尺实时 | ✅ | 手势期只重建 `#tickmarks`（约 5 个节点），不整片隐藏 |
| 类别批量编辑与偏移 | ✅ | `kindOffsets` 实测：轨道名 dx=6 → 三个 label x 70.6→76.6；类别字号/对齐/显隐/粘贴样式齐全 |
| 多文档批量导入 | ✅ | 6 文件拖入 664 ms；DOM 只挂载 1 个文档（57→15,627 节点）；重复按内容哈希跳过 |
| ZIP 批量导出 | ✅ | `reports/e2e_batch_export.json`：3 张图 + manifest，逐张 `built 7569 = reparsed 7569`，`status: ok` |
| 真实鼠标/CDP 测试 | ✅ | `reports/e2e_real_mouse.json` 10/10（真鼠标、真键盘、真下载） |
| 性能 JSON | ✅ | `perf_v2.json`、`perf_15tracks.json`（合成）、`perf_memory.json` |
| 源码工程 | ✅ | `dist/IGV-Single-SVG-Studio-src.zip`（含 src/electron/scripts/fixtures/reports） |
| 录屏 | ✅ | `reports/demo.gif`（68 帧，CDP screencast） |

## 科学不变量（回归）

- `npm test` **14/14**：T4a 信号对象 7,675 = 7,675；T9 裁剪前后峰高 3.3907 pt 不变；T12 标定冲突阻止导出；T14 Session 15 轨配置解析。
- `npm run test:real` **10/10**：导出的 SVG 重新打开仍是 3 轨、`both`、无位图。

## 未达成的验收（一条）

**真实 15 轨 SVG 的 p95 未验收。** 手上只有 3 轨真实导出；`fixtures/panel_15tracks_stress.svg` 是 3 轨复制 5 份的**合成**夹具（文件头已标 SYNTHETIC，3.67 MB / 38,545 信号对象 / 77,452 DOM 节点），实测 zoom/pan 每帧工作 p95 **2.8–3.0 ms**、手势期 build 0 次。它可以证明"5 倍节点量下仍远低于 16.7 ms"，但不能替代真实 15 轨导出。

## 未验证项

1. Windows 安装包未在真实 Windows 上安装启动。
2. 原生打开/保存对话框的真人点击未自动化；只验证了对话框之后的写盘/读文件链路（`IGV_TEST_SAVE_DIR` / `IGV_TEST_OPEN_FILES` 测试缝）。
3. GIF 而非 MP4（本机无 ffmpeg）。
4. `Runtime.getHeapUsage` 只覆盖 JS 堆，不含 DOM 原生内存。

## 复现

```bash
npm install && npm run build && npm run standalone
npm test && npm run test:e2e && npm run test:real
npm run test:layers && npm run test:drop && npm run test:batch
npm run test:canvas-zoom && npm run test:apply-all && npm run test:standalone
npm run perf && npm run perf:15 && npm run perf:memory
npm run pack:app && npm run dist:mac && npm run dist:win   # 需要网络镜像变量
node scripts/e2e-electron.mjs                               # 需先 dist:mac 出 .app
```

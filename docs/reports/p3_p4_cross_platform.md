# P3 跨平台保真与性能对照 / P4 迁移结论

日期：2026-11-12。同机（macOS 26.2，Apple Silicon）、同文件、同一段应用内 harness（`window.__studioBench`）。

---

## 0. 先把三种"一致"分开

| 层次 | 含义 | 本轮结论 |
|---|---|---|
| **字节一致** | 导出的 SVG 文件 SHA-256 相同 | ✅ 3 轨与 15 轨（合成）两个夹具都**逐字节相同** |
| **语义一致** | 对象数、坐标标定、字号/颜色/线宽等属性值相同 | ✅ 信号对象数、文本数、标定方式一致；字节相同已隐含属性相同 |
| **渲染一致** | 屏幕/打印的光栅结果一致 | ❌ **未验证**。WKWebView 与 Chromium 的字体光栅化不同，字节相同不等于像素相同 |

**SHA-256 相同只能证明前两层**，不能替 Illustrator 打开、也不能替屏幕观感背书。

## 1. 夹具

| 夹具 | 性质 | 规模 |
|---|---|---|
| `fixtures/panel_igv2198.svg` | **真实** IGV 2.19.8 导出 | 735 KB，3 轨，7,675 信号对象，基因模型 + 标尺 + 轨道名 + 数据范围 |
| `fixtures/panel_15tracks_stress.svg` | **合成**（真实 3 轨文件竖直复制 5 份，文件头已标 SYNTHETIC） | 3.67 MB，解析出 19 个带 / 38,545 信号对象 / 77,452 DOM 节点 |

**没有真实 15 轨 GPU/IGV 导出**，所有"15 轨"数字都来自合成夹具，不能冒充真实科研数据。

## 2. 保真对照

### 真实 3 轨

| 项 | Electron（Chromium） | Tauri（WKWebView） |
|---|---|---|
| 导出字节 | 1,665,271 | 1,665,271 |
| SHA-256 | `b94c3938…13da9c76` | **同左** |
| 信号对象 | 7,675 | 7,675 |
| `<text>` / `<image>` / `<foreignObject>` | 11 / 0 / 0 | 11 / 0 / 0 |
| 标定方式 | `both`（刻度与 locus 双源一致） | 同左 |
| 纵轴信号映射 | 由 `ky` 固定，裁剪不变 | 同左（导出字节相同） |

Tauri 侧磁盘文件复核：`selftest_a.edited.svg` 1,665,271 B，`shasum -a 256` 与上表一致；XML 良构，`rect` 4,932、`line` 2,753。

### 合成 15 轨

| 项 | Electron | Tauri |
|---|---|---|
| 导出字节 | 8,394,805 | 8,394,805 |
| SHA-256 | `6e8b4863…cb56316` | **同左** |
| 信号对象 | 38,545 | 38,545 |

### 渲染层（未做）

- 没有对同一 SVG 做 WKWebView 与 Chromium 的逐像素比对。
- 字体差异理论上存在（抗锯齿、hinting、字距微调），但**导出的矢量文件里字体是属性值**（`font-family="Arial" font-size="5"`），所以"文件层面"无差异。
- Illustrator 打开：两个平台都没有实测（本机无 Illustrator）。

## 3. 性能对照

| 指标 | Electron 3 轨 | Tauri 3 轨 | Electron 15 轨（合成） | Tauri 15 轨（合成） |
|---|---|---|---|---|
| 导入 | 191 ms | 190 ms | 908 ms | 813 ms |
| 缩放 每帧同步工作 p50 / p95 | 1.4 / 2.3 ms | 1.0 / 1.0 ms | — / 7.7 ms | — / 4.0 ms |
| 平移 每帧同步工作 p50 / p95 | 1.2 / 1.4 ms | 1.0 / 1.0 ms | — / 6.1 ms | — / 4.0 ms |
| 手势期 `buildSVG` | 0（结束时 1 次提交） | 同左 | 0 | 0 |

- 15 轨合成夹具下，两边每帧同步工作都 < 8 ms，远低于 16.7 ms 预算。
- **帧时间（frameP95）我没有当作结论**：Tauri 的帧循环带 40 ms 定时器兜底（窗口遮挡时 rAF 不触发），Electron 的帧里含一次 27 ms 提交重建，两者口径不同。
- Windows 运行时数据：**无**。CI 只产出安装包，没有可运行 Windows 的环境去采集。

## 4. 已知问题与未测试

1. Windows：安装/启动/卸载、WebView2 缺失时自动下载，均未实机验证。
2. Windows：原生拖放与 HTML5 的冲突未实测。
3. 系统级文件拖拽手势（两个平台）无法自动化。
4. 原生打开/保存对话框的真实点击未自动化（用环境变量测试缝绕过）。
5. 屏幕渲染一致性与 Illustrator 可编辑性未验证。
6. 真实 15 轨数据缺失，15 轨结论基于合成夹具。

## 5. P4 结论

**当前不建议直接把 Tauri 作为正式版替换 Electron。** 理由按证据强度排序：

1. **P1 通过**：Windows x64 NSIS 安装包已由 GitHub Actions 产出（未签名），SHA-256、版本信息、构建日志齐全。
2. **P2 在 macOS 上通过**：8 项自动化全绿（含真实磁盘文件、ZIP、多文档、撤销、预设、坏文件、单实例），另有 2 项部分覆盖（拖拽手势、对话框）。
3. **P3 字节与语义层面通过**，渲染层面未验证。
4. **缺一块关键证据**：Windows 上的真实运行。安装包能不能装、装完能不能开、拖放冲不冲突、导出是否一致——这些必须在 Windows 上发生一次，才能说"跨平台可替换"。

### 建议的下一步（按顺序）

1. 找一台 Windows 10/11 x64，安装 `IGV Studio_2.0.0_x64-setup.exe`，跑：启动 → 拖入 SVG → 导出 SVG → 打开导出文件 → 重复启动验证单实例 → 卸载。
2. 若通过，再补 Illustrator 打开与一次屏幕观感对照（WKWebView vs Chromium）。
3. 两项都过 → 把 Tauri 设为默认分发，Electron 分支保留一个版本周期后归档。
4. 若要正式分发，仍需要 Apple Developer ID + 公证（macOS）和 Windows 代码签名证书；本轮都是 ad-hoc/未签名。

## 6. 数据文件

- `reports/perf_compare_electron_vs_tauri.json`（3 轨）
- `reports/perf_15tracks_electron_vs_tauri.json`（合成 15 轨）
- `reports/bench_coldstart.json`（冷启动 3×2）
- `reports/selftest_tauri.json`（桌面功能自检）
- `reports/tauri_windows_and_regression.md`（P1/P2 详表）

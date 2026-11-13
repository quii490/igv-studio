# Tauri 2：Windows 构建（P1）与桌面功能回归（P2）

日期：2026-11-12。分支 `tauri-poc`，远端 `quii490/igv-studio`（私有）。

---

## P1. Windows 构建（GitHub Actions）

| 项 | 值 |
|---|---|
| Workflow | `.github/workflows/tauri-windows.yml` |
| Runner | `windows-latest`（`win25-vs2026`） |
| 最终 run | `43155832784`（`5b00bd4`），此前 `43153239816` 首次成功 |
| 工具链 | Node 20 + `dtolnay/rust-toolchain@stable` + `tauri-apps/tauri-action@v0` |
| 目标 | `x86_64-pc-windows-msvc` |
| 打包 | NSIS（Nullsoft Install System v3.13，从安装包 manifest 读出） |
| WebView2 | `downloadBootstrapper` —— 有独立校验步骤，run 日志：`WebView2 install mode: downloadBootstrapper` |
| 签名 | **未签名**（`VERSION.json` 里 `signed: false`） |

产物（`release/tauri/windows/`）：

```
IGV Studio_2.0.0_x64-setup.exe   1,640,225 B
  SHA-256 e19358bcb08810197939497f359b6531390a71ab3a6955dfc1ea2e57242d5551
igv-studio-portable.exe          6,160,384 B   (PE32+ x64 GUI，未经安装直接运行用)
  SHA-256 14b2532e9fb721ddd29071859b7f01ffca249a5cde8a901220deb7c86a6411d8
SHA256SUMS.txt / VERSION.json
VERSION.json   { product IGV Studio, version 2.0.0, target x86_64-pc-windows-msvc,
                 installer nsis, webview2 downloadBootstrapper, signed false }
```

本机 `shasum -a 256 -c` 复核两个文件均 OK（CI 生成的 SHA256SUMS 是 CRLF 行尾，随包副本已转成 LF）。

安装包 PE 资源核对：图标 7 个尺寸，`ProductName=IGV Studio`、`FileVersion=2.0.0`。

首次 CI 失败（run `43151735888`）：`src-tauri/icons/icon.ico` 缺失，tauri-build 生成 Windows 资源时找不到；补图标后重跑通过。这条本身是 Windows 与 macOS 构建差异的真实教训，已修。

**未做**：安装包没有在真实 Windows 上安装运行过（本机无 Windows，也没有可用的 Windows 虚拟机/Wine 运行 Tauri 应用）。因此“安装逻辑、WebView2 缺失时是否自动下载、卸载是否干净”都只有配置级证据。

## P2. 桌面功能回归（在 Tauri macOS 打包 App 内跑）

自检入口：`IGV_SELFTEST=1 IGV_TEST_SAVE_DIR=… IGV_SELFTEST_OUT=…`，脚本走**真实 platform bridge**（Tauri 命令 → 真磁盘），不是 `__studioBench` 返回字符串。证据：`reports/selftest_tauri.json`。

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 1 | 单文件导入 | 通过 | 文档数 1，轨道名出现 |
| 2 | 单张 SVG 写入磁盘 | 通过 | `/tmp/igv-tauri-save/selftest_a.edited.svg`，**1,665,271 B**，SHA-256 `b94c3938…13da9c76` |
| 3 | 多文档隔离 | 通过 | 2 个文档，画布上只有 **1** 个 `<svg>` |
| 4 | 撤销 / 重做 | 通过 | 轨道名 y：27.688 → 拖到 57.897 → 撤销回 27.688 → 重做 57.897 |
| 5 | FigureR1 样式 | 通过 | 切到 Exact 后数据范围 x：1.2 → 72.7 |
| 6 | 坏文件不跳转 | 通过 | URL 不变；状态栏 `跳过 1 个：broken.svg（SVG XML 解析失败）` |
| 7 | 批量 ZIP | 通过 | `IGV-Studio-Export.zip` 67,606 B；解压得 2 个独立 SVG + manifest，两个都 `verified: true` |
| 8 | 单实例 | 通过 | 第二次启动 **56 ms** 退出，进程数仍为 1 |
| 9 | 拖放（原生） | **部分** | 原生 `onDragDropEvent` → `read_files` → `importPayloads` 链路与命令已验证；**系统级拖拽手势没有自动化**，macOS 上无法脚本化 Finder 拖拽 |
| 10 | 原生打开/保存对话框 | **部分** | 命令实现且被测试缝绕过；对话框本身未自动点击 |

补充校验（对写出的文件，不是对返回值）：

- 导出的 SVG：XML 良构，`<image>` 0、`<foreignObject>` 0、`<text>` 11、`<rect>` 4,932、`<line>` 2,753。
- ZIP 内两个 SVG 的 SHA-256 分别是 `b94c3938…`（A）与 `5897984b…`（B），manifest 均 `status: ok`。

### 本轮修掉的真 bug

`saveAs` 的 `useCallback` 依赖是空数组，导致它永远捕获第一帧的 `bridge = null`，在 Tauri 里静默走浏览器 `download()` 分支——导出“成功”但没有文件。加 `[bridge]` 后修复；`exportZip` 同样缺依赖，一并修。这个 bug 只有“检查磁盘上的文件”才发现，正是这轮要求的验证方式。

## 独立审计（2026-11-12）响应

审计对两个二进制包的结论是「包结构与内部哈希通过，功能/性能/保真未验证」。逐条处理：

| 审计项 | 本轮处理 | 证据 |
|---|---|---|
| P0-1 Windows 实机冒烟 | **仍缺**。没有 Windows 机器/VM；安装、卸载、WebView2 缺失、拖放、单实例、导出均未在真实 Windows 上跑过 | 本报告「未测试」清单 |
| P0-2 macOS 实机 + x64 | x64 DMG 早已产出（`IGV-Studio-tauri-x64.dmg`，`lipo` 见 `reports/p3_p4_cross_platform.md`）；**新增 DMG 内 Applications 快捷方式** | `hdiutil attach` 列表：`Applications -> /Applications` |
| P0-3 真实 15 轨 | **仍缺**。只有 3 轨真实 + 合成 15 轨压测（已标注 SYNTHETIC） | `reports/perf_15tracks_electron_vs_tauri.json` |
| P0-4 源码与产物对应 | 仓库 `quii490/igv-studio`（私有）分支 `tauri-poc`；`VERSION.json` 记录 `source_commit`；CI 每次从同一 commit 构建 | `release/tauri/VERSION.json` |
| P0-5 生产构建清理 | **已做**：`Tauri PoC` 字样删除；测试钩子改为 cargo feature `test-hooks`（默认关闭），`write_diag`/`bench_config`/`IGV_TEST_SAVE_DIR` 在生产构建里编译为空实现；前端 bench/self-test 通过 `DEV_HARNESS` 在 production 模式被 tree-shake | 生产二进制 `strings` 命中数 **0**（IGV_BENCH / IGV_SELFTEST / IGV_TEST_SAVE_DIR / Tauri PoC / __studioBench） |
| mac DMG 缺哈希清单 | 新增 `release/tauri/SHA256SUMS.txt` + `VERSION.json`（版本、runtime、架构、签名方式、commit、构建时间） | 见同一目录 |
| Windows ZIP 带 `__MACOSX` | 用 `zip -X` 重新打包，无 AppleDouble | `release/tauri/IGV-Studio-tauri-windows-x64.zip` |

另外：审计提到「即使字节相同也只证明回归一致性」——这一点我在 `p3_p4_cross_platform.md` 里已经分三层写过（字节/语义/渲染），没有把 SHA-256 当作视觉一致或科学正确。

### 本轮最终产物（commit `d0e0bf5`）

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `IGV-Studio-tauri-windows-x64.zip` | 7,788,267 | `24f7d43e…f5ccce` |
| `windows/IGV Studio_2.0.0_x64-setup.exe` | 1,638,510 | `49c1e99e…8d4679` |
| `windows/igv-studio-portable.exe` | 6,149,120 | `051f0f8f…f79083` |
| `IGV-Studio-tauri-arm64.dmg` | 2.4 MB | `2d32fb81…88ccf855` |
| `IGV-Studio-tauri-x64.dmg` | 2.4 MB | `3ecb0c75…766e5475` |

Windows 二进制里 `IGV_BENCH` / `IGV_SELFTEST` / `IGV_TEST_SAVE_DIR` / `Tauri PoC` 字符串命中数 0；CI 另有一步 `Assert production frontend has no dev harness`，日志输出 `production bundle clean`。
**注意**：Tauri 会把前端资源压缩嵌入，不能靠 `strings` 检查 JS 内容；前端清理的证据是 CI 断言 + `VERSION.json` 的 `source_commit`，不是字符串搜索。

界面右下角新增构建标记 `Electron/Tauri · build <sha>`，用户可直接回报自己运行的版本。

## 修复记录三：交互小 bug 巡检（2026-11-12）

用一个覆盖 10 项的交互脚本 `scripts/e2e-audit.mjs`（证据 `reports/e2e_audit.json`）扫了一遍，发现并修掉 3 个：

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | **轨道刻度点不中**（用户报告） | `collectObjects` 把 tick 标成 `locked: true`，`onPointerDown` 直接 return；「选择所有同类」也把 locked 过滤掉 | 刻度改为可选（仍 `bound`，不可改文字），下拉面板按类别可调；同类批量包含刻度 |
| 2 | 缩放后选框与文字错位 | 选框测量 effect 的依赖是 `uiScale`，而烘焙模式下 `uiScale` 恒为 1，缩放不触发重测 | 依赖里加 `zoomPx` |
| 3 | 点画布空白处不清空选择 | `onPointerDown` 只挂在 `.paper` 上，画布灰色区域根本没事件 | `.canvas` 加冒泡清理（排除对象/手柄/选框） |

另外顺手加固：内联文本框按 Enter 时改为读 `e.target.value`，不再用可能过期的 `editing.value`。

复测：10 项全过（刻度选中、Shift 多选、方向键微移 1 px、Delete 隐藏 + ⌘Z 恢复、双击进入编辑并改出 `IgG-edited`、导出包含该文字、空白点击清空、200% 下选框对齐偏差 -2/-2 px 即边框宽、类别显隐 0/3）。

已知遗留：刻度的位置由坐标重算，缩放窗口后每刻度的位移会重新对齐（按 bp id 存储），这是设计取舍，未改。

## 修复记录二：点「适应」后变糊

原因：缩放一直用 CSS `transform: scale(z)` 施加在 `.paper` 上。浏览器会先按**布局尺寸（231.6 px）**光栅化，再放大到 924 px，所以放大后文字与曲线是位图插值——不是矢量重绘。

修法：分两种状态——
- **手势进行中**（滚轮连发）：仍用 `transform`，只做位移和缩放，不重排；
- **手一停**（按钮缩放立即、滚轮 220 ms 提交后）：把 SVG 的布局宽度改成真实像素宽度（`.paper` 宽 = 924 px），`transform` 只保留平移，浏览器按 924 px 重新光栅化。

实测（同一视角）：

| 状态 | `.paper` 样式宽度 | transform | 结果 |
|---|---|---|---|
| 手势中 | 231.6 px | `translate(0,0) scale(3.98964)` | 放大插值 |
| 手停后 | **924 px** | `translate(0,0)` | 按目标尺寸重绘，文字锐利 |

截图 `reports/zoom_crisp_after_fit.png`；边缘能量与手停前一致（7.21 vs 7.21），说明不是缩略图，而是真实像素。

## 修复记录：画布"适应/缩放"失控

用户报告点击「适应」后画布不断缩小。根因：`fitZoom()` 量的是**已经被缩放过的** `.paperWrap`（宽度 = `widthPt × 96/72 × zoom`），于是
`fit = (W·z − 48)/W = z − 48/W`，每点一次就缩一点。

修法：改为量视口 `.canvas` 的内宽（减去 padding），并对「适应」重置平移与滚动。顺带确认 Ctrl/⌘+滚轮的锚定逻辑仍精确（光标下对象漂移 **0.9 px**），缩放到铺满后可自动回到居中（按钮缩放 160 ms 后、滚轮提交 60 ms 后各检查一次是否已装得下）。

回归：科学 14/14、交互 17/17、`e2e-canvas-zoom` 通过、Tauri 自检 7/7。

## 与 Electron 的差异（本轮新增）

| 项 | Electron | Tauri |
|---|---|---|
| 单实例 | `requestSingleInstanceLock` | `tauri-plugin-single-instance`（新增） |
| 文件 IO | preload + IPC | 6 个白名单命令（`open_files/read_files/save_text/save_binary/write_diag/bench_config`） |
| 拖放 | HTML5 `drop` | 原生事件（`dragDropEnabled: true` 会屏蔽 HTML5） |
| 测试缝 | `IGV_TEST_SAVE_DIR` | 同名环境变量，行为一致 |

## 未测试（明确列出）

1. Windows 上安装、启动、卸载、WebView2 缺失时的自动安装。
2. Windows 上原生拖放与 HTML5 的冲突（需要运行中的 Windows 应用）。
3. 两个平台的系统级文件拖拽手势（无自动化手段）。
4. 原生文件对话框的真实点击。
5. Illustrator 打开导出的 SVG。

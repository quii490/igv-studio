# Tauri 2 迁移 PoC —— 结论与证据

结论先说：**技术上可行，图形保真度完全通过（导出字节级一致），包体积缩小约 98 倍；但本轮不构成"应该迁移"的结论**——性能没有可测的提升、Windows 包未产出、原生拖放在 macOS 上无法与 HTML5 拖放共存需要取舍。

分支：`tauri-poc`（基线 `electron` 分支保持不动）。Electron 2.0.0 的构建与测试仍全部通过。

---

## 1. 复用了什么 / 换了什么

| 模块 | 处理 |
|---|---|
| `src/core/parser.ts`（IGV 2.19.8 SVG → Panel IR） | **原样复用**，零改动 |
| `src/core/engine.ts`（buildSVG / 标定 / FigureR1） | **原样复用**，零改动 |
| `src/core/preset.ts`、`session.ts`、`labels.ts` | 原样复用 |
| `src/App.tsx`（编辑、撤销、多选、类别批量、分层渲染） | 复用；只把 `native`（Electron preload）换成一个运行时桥 |
| Electron 主进程 / preload | 仅 PoC 保留，Tauri 下不使用 |
| 文件读写、对话框 | Electron: preload + IPC；Tauri: 6 个白名单 Rust 命令（`open_files` / `read_files` / `save_text` / `save_binary` / `write_diag` / `bench_config`） |
| 拖放 | Electron: HTML5 `drop`；Tauri: 原生 `onDragDropEvent` → `read_files` |

新增文件很少：

```
src/platform/bridge.ts     运行时抽象（electron / tauri / web 三选一，业务代码不再判断"我是不是 Electron"）
src-tauri/src/lib.rs       6 个命令，rfd 原生对话框 + 标准库文件 IO
src-tauri/tauri.conf.json  frontendDist = ../dist（与 Electron 共用同一份前端产物）
src-tauri/capabilities/default.json  只给 core:default
```

**没有复制第二份前端**：Tauri 打包时直接 `frontendDist: "../dist"`，与 Electron 用同一套 React + 同一份 SVG 引擎。

## 2. 保真度：导出字节级一致

同一份真实 IGV SVG（735 KB、3 轨、7,675 个信号对象、基因模型、标尺、轨道名、数据范围），在两个运行时里跑**同一段 `window.__studioBench`**，导出并计算 SHA-256：

| 运行时 | 引擎 | 字节数 | SHA-256 |
|---|---|---|---|
| Electron 2.0.0 | Chromium | 1,665,271 | `b94c3938…13da9c76` |
| Tauri 2.12（arm64） | WKWebView | 1,665,271 | `b94c3938…13da9c76` |
| Tauri 2.12（x64 / Rosetta） | WKWebView | 1,665,271 | `b94c3938…13da9c76` |

三者**完全一致**。信号对象 7,675、`<text>` 11 个、`<image>` 0、`<foreignObject>` 0。

也就是说：**WebKit 与 Chromium 的字体/SVG 排版差异，在本项目的导出产物上为零**——因为我们从不依赖浏览器重绘科学图形，只做坐标变换与文字属性写入。这一点是这轮最重要的结论。

## 3. 性能（同机、同文件、同操作序列）

| 指标 | Electron | Tauri | 说明 |
|---|---|---|---|
| 冷启动（3 次） | 1051 / 264 / 199 ms | 1006 / 293 / 278 ms | 中位数 264 vs 293；两者里程碑不同（Electron 到 CDP 页面就绪，Tauri 到 JS 启动标记） |
| 首次导入 | 191 ms | 190 ms | 一致 |
| 基因组缩放 每帧同步工作 p95 | 2.3 ms | 1.0 ms | 可比项 |
| 平移 每帧同步工作 p95 | 1.4 ms | 1.0 ms | 可比项 |
| 手势期 buildSVG 次数 | zoom 1 / pan 0 | zoom 1 / pan 0 | 一致 |
| 导出字节 | 1,665,271 | 1,665,271 | 一致 |

**不能当作结论的数字**：`frameP95`（Electron zoom 93.3 ms、Tauri 15–16 ms）。Tauri 的帧循环里我加了 40 ms 的定时器兜底（窗口被遮挡时 rAF 不触发），所以那个 15 ms 是兜底上限，不是真实帧时间；Electron 的 93 ms 里含一次 27 ms 的提交重建。两边的"帧"测量口径不一致，我**没有**拿它做结论。

## 4. 打包

| 产物 | 大小 |
|---|---|
| `release/tauri/IGV-Studio-tauri-arm64.dmg` | **2.2 MB** |
| `release/tauri/IGV-Studio-tauri-x64.dmg` | 2.3 MB |
| 解压后 `.app` | **8.4 MB**（arm64）/ 8.5 MB（x64） |
| 对照：Electron `.app` / `.dmg` | 417 MB / 180 MB |

系统依赖：macOS 自带 WKWebView，无额外运行时；Windows 计划用 `webviewInstallMode = downloadBootstrapper`（不内嵌离线 WebView2，已写进 `tauri.conf.json`，但**没有构建过**）。

签名：两个 DMG 内的 `.app` 都做了 ad-hoc 签名（`codesign --sign -`），**不是** Apple 公证；分发时同样会被 Gatekeeper 拦一次。

Windows 包**未产出**：本机是 macOS，没有 MSVC 链接器，`rustup target list` 里也只有两个 apple target。要在 Windows 上执行：

```bash
npm run build && npm run standalone
npx tauri build --target x86_64-pc-windows-msvc
```

## 5. 拖放：必须做取舍（这是本轮的实际障碍）

- Tauri 窗口开启 `dragDropEnabled: true` 时，**原生拖放事件会接管**，HTML5 `drop` 不再触发。
- 我的处理：桥接层暴露 `supportsNativeDrop`；Tauri 走 `onDragDropEvent` → `read_files` → 同一套 `importPayloads`；Electron/浏览器仍走 HTML5。
- 这意味着**同一份业务逻辑、两条拖放通路**，而不是复制业务代码。但 windows 上两者的冲突行为我**没有实测**（无 Windows 机器），这是迁移前必须补的一项。

## 6. 未验证 / 风险

1. **Windows 安装包与拖放冲突**：未构建、未实测。
2. **原生对话框**：Tauri 用 `rfd`，我只验证了命令能编译、应用能启动；**没有自动点过对话框**（与 Electron 同样的限制）。
3. **Illustrator 打开**：两版都没在 Illustrator 里实测，无法给出"可正常打开"的断言。SHA-256 一致只能说明产物与 Electron 版逐字节相同。
4. **帧时间**：上面已说明口径问题，未做真实输入下的逐帧对比。
5. **内存**：没有可比指标。Electron 可用 `Runtime.getHeapUsage`，WKWebView 没有等价接口，用 RSS 对比又会被共享内存污染，我没有编数字。

## 7. 建议

- **保真度与体积**上，Tauri 明显有利（8.4 MB vs 417 MB，导出逐字节一致）。
- **性能**上，本机没有测出差异；"Tauri 更快"这句话本轮没有证据支持。
- **交互**上，原生拖放与 HTML5 的冲突是真实成本，需要 Windows 实测后才能定。
- 建议下一步：先在 Windows 机器上构建 + 实测拖放，再决定是否迁移；迁移成本主要在桥接层（已写好）和打包/签名流程，而不是业务代码。

## 8. 复现

```bash
# 前端（两套共用）
npm run build && npm run standalone

# Tauri
npm run tauri:build          # arm64 .app
npm run tauri:build:x64      # x64 .app（交叉编译）
codesign --force --deep --sign - --identifier org.igvstudio.app "src-tauri/target/release/bundle/macos/IGV Studio.app"
hdiutil create -volname "IGV Studio" -srcfolder "…/IGV Studio.app" -ov -format UDZO out.dmg

# 对照测试
node scripts/bench-electron.mjs    # Electron 打包 App 内跑同一段 harness
node scripts/bench-coldstart.mjs   # 冷启动 3×2

# Tauri 基准（应用内自测，写 JSON）
IGV_BENCH=1 IGV_BENCH_FIXTURE="$PWD/fixtures/panel_igv2198.svg" \
  IGV_BENCH_OUT=/tmp/igv-tauri-bench.json \
  "src-tauri/target/release/bundle/macos/IGV Studio.app/Contents/MacOS/igv-studio"
```

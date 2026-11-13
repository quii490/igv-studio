# 审计：能不能直接把 DMG / 安装包发给别人，开箱即用？

结论先说：**能发，但“开箱即用”不成立**。两个包都会在第一次启动时被系统拦一次；macOS 上还需要对方改一次系统设置或跑一条命令。要真正做到零提示，必须有 Apple Developer ID（99 美元/年）+ 公证，以及 Windows 代码签名证书——这两样我这边都没有。

另外修掉了两个会直接导致“对方根本打不开”的问题：**只支持 Apple Silicon**、**应用包签名损坏**。

---

## 一、macOS：已修复的两个硬伤

| 问题 | 修复前 | 修复后 | 证据 |
|---|---|---|---|
| CPU 架构 | 只有 `arm64`，Intel Mac 直接打不开（`bad CPU type in executable`） | **universal**：`lipo -archs` → `x86_64 arm64` | `release/mac-universal/IGV Studio.app` |
| 签名状态 | `spctl` 报 **`code has no resources but signature indicates they must be present`**（就是 Finder 里“已损坏，请移到废纸篓”那类） | 正确 ad-hoc 签名：`Identifier=org.igvstudio.app`、`Sealed Resources version=2 rules=13 files=10`、`codesign --verify --deep --strict` → **valid on disk / satisfies its Designated Requirement** | 见下 |

修复前那条 `spctl` 输出对应的就是“damaged”。之前那一版是我漏了 — electron-builder 找不到证书时直接跳过签名，我没有补 ad-hoc 签名。

## 二、macOS：仍然会被拦（这条修不掉，除非有证书）

```
$ spctl --assess --type execute -vvvv "IGV Studio.app"
IGV Studio.app: rejected
```

原因是没有 Apple Developer ID，也没有公证（notarization）。对方第一次双击的典型结果：

> “Apple 无法验证 IGV Studio 是否包含可能损害 Mac 的恶意软件。”

**对方需要做的（macOS 15/26 上右键→打开已不再适用）：**
1. 双击后按提示 → 系统设置 → 隐私与安全性 → 找到 IGV Studio → **仍要打开** → 确认；
2. 或者一条命令：
   ```bash
   xattr -dr com.apple.quarantine "/Applications/IGV Studio.app"
   ```

**一个诚实的限制**：我在本机用 `xattr` 手工打 quarantine 标记后 `open`，应用被 App Translocation 拉起来并成功运行。手工写的 quarantine 属性不完全等同于浏览器下载的真实来源信息，**所以我无法在本机复现“别人下载后第一次双击”的完整拦截流程**。上面那句“会被拦”依据的是 `spctl` 判定与 macOS 对未公证应用的既有策略，不是我在这台机器上看到的现象。

## 三、Windows：能装，但会过一次 SmartScreen

- 安装包：`release/IGV Studio Setup 2.0.0.exe`，NSIS x64，未签名。
- 对方第一次运行：**“Windows 已保护你的电脑”** → 更多信息 → 仍要运行。
- 图标与版本号已写进 PE：应用 exe 与安装包各 7 个尺寸，`ProductName=IGV Studio`、`FileVersion=2.0.0.0`（用 resedit 读回核对）。
- 限制：**没有在真实 Windows 上安装运行过**，只做了 PE 结构与资源校验。

## 四、图标：已经加回来了（之前的问题不是“没有”，是“显示不对”）

- 上一版 `.icns` 其实是 IGV 图标，但**图稿四周留白 + 圆角**，macOS 又套了一层系统圆角遮罩，Dock 里看起来是一个白框里的小图标，像是“图标没了”。
- 现在重画为**满幅**图稿（macOS 自己负责圆角），用 `NSWorkspace` 渲染核对：

  `reports/icon_macos_512.png`（512×512，深蓝底 + IGV + 三条轨道）
- DMG 现在也带**卷图标**（`.VolumeIcon.icns`）与拖拽安装背景，挂载后不再是通用磁盘图标。
- Windows 用另一版（保留圆角、无系统遮罩），已嵌入两个 exe。

## 五、发之前建议做的事

1. 发 **universal** 那个：`IGV Studio-2.0.0-universal.dmg`（180 MB）。旧的 `arm64` 版已移到 `archive/20261112/`，别发错。
2. 附一段说明给接收方（macOS 的“仍要打开”、Windows 的“仍要运行”），我已经写进 `dist/IGV-Studio-README.txt`。
3. 如果对方是重要合作者、又不想看到任何警告：需要你提供 Apple Developer ID（我可以用它重新签名 + `notarytool` 公证，之后 `spctl` 会显示 `accepted`），Windows 则需要一张代码签名证书。

## 六、复现命令

```bash
lipo -archs "release/mac-universal/IGV Studio.app/Contents/MacOS/IGV Studio"     # x86_64 arm64
codesign -dv --verbose=2 "release/mac-universal/IGV Studio.app"                   # adhoc + Sealed Resources
codesign --verify --deep --strict --verbose=2 "release/mac-universal/IGV Studio.app"
spctl --assess --type execute -vvvv "release/mac-universal/IGV Studio.app"        # rejected（无 Developer ID）
node scripts/e2e-electron.mjs                                                     # 在签名后的 universal 包里跑，10 项全过
```

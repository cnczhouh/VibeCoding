# 24色卡实时统计工具

一个基于 **Python + PySide6 + OpenCV** 的桌面小工具，用于对 **Macbeth / ColorChecker 24 色卡** 做实时采样与统计分析。

适合：
- ISP 学习与调试辅助
- 图像测试场景快速验证
- 对屏幕、图片、视频、摄像头中的 24 色卡进行手动 ROI 分析

## 功能特性

- 支持 **本地图片** 输入
- 支持 **本地视频** 输入
- 支持 **摄像头** 输入
- 支持 **屏幕实时采集** 输入
- 支持拖拽 **四点 ROI** 对准色卡四角
- 支持透视校正，适配倾斜拍摄/显示场景
- 主图叠加 **6×4 色块网格**，方便对齐 patch
- 悬浮窗实时显示 24 个色块统计结果
- 支持统计：
  - RGB 均值
  - 灰度 / 亮度均值
  - ΔE76
- 支持 Windows 下打包为双击启动 EXE

## 界面说明

主窗口：
- 打开图片
- 打开视频
- 打开摄像头
- 采集屏幕
- 重置 ROI
- 调整采样比例
- 选择摄像头索引 / 屏幕索引

悬浮窗：
- 始终置顶
- 显示 24 个 patch 的编号、名称、RGB、Gray、ΔE76
- 显示平均 ΔE、最大 ΔE、最亮块、最暗块

## 使用方式

### 方式 1：直接运行 Python

先安装依赖：

```bash
pip install -r requirements.txt
```

运行程序：

```bash
python app.py
```

### 方式 2：双击运行打包后的 EXE

已支持目录版 EXE。
打包完成后，直接双击：

```text
dist/24色卡实时统计工具/24色卡实时统计工具.exe
```

## 操作步骤

1. 启动工具
2. 选择输入源：图片 / 视频 / 摄像头 / 屏幕
3. 在主图中拖动四个角点，对准 24 色卡四角
4. 观察主图上的 6×4 网格是否和每个 patch 对齐
5. 在悬浮窗查看实时统计结果
6. 如有需要，微调“采样比例”减少边缘串色影响

## 依赖环境

- Python 3.12（当前开发环境）
- PySide6
- OpenCV
- NumPy
- mss
- PyInstaller（用于打包）

## 项目结构

```text
app.py
build.bat
requirements.txt
core/
  color_metrics.py
  controller.py
  geometry.py
  reference.py
  sampler.py
  source.py
ui/
  floating_stats.py
  main_window.py
  overlay_view.py
```

## 打包

安装依赖后，可直接执行：

```bash
build.bat
```

或手动执行：

```bash
pyinstaller --noconfirm --windowed --name "24色卡实时统计工具" --collect-all PySide6 --hidden-import mss app.py
```

## 当前限制

- 当前 ROI 适配主要是 **四点透视校正**，还不是完整镜头畸变标定
- ΔE 目前实现的是 **CIE76**
- 24 色卡位置目前需要手动框选，尚未加入自动检测
- 更适合做学习、验证和测试辅助，不是严格色彩学标定工具

## 后续可扩展方向

- 自动检测 24 色卡
- 导出 CSV / Excel 报告
- 支持 ΔE2000
- 支持 patch 编号标注
- 支持结果截图与历史记录
- 支持镜头畸变参数校正

## 仓库说明

当前分支：
- `feature/colorchecker-tool`

如果你想把它合并到主分支，可以基于这个分支创建 PR。

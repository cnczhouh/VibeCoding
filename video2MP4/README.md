# 视频链接转文字工具

这个小工具可以把一个视频链接处理成文字稿：

1. 通过 `yt-dlp` 下载视频
2. 通过 `ffmpeg` 抽取音频
3. 通过本地 Whisper 模型识别成文字
4. 输出 `.txt`、`.srt` 字幕和 `.json` 结构化结果

请只处理你有权下载和转写的视频内容，并遵守对应平台的服务条款。

## 安装

建议先创建一个独立环境：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install -r requirements.txt
```

项目使用 `imageio-ffmpeg` 自动提供 ffmpeg，所以电脑上没有单独安装 ffmpeg 也能运行。

## 使用

最简单的用法：

```powershell
python .\video_to_text.py "https://example.com/video-url"
```

## Web 版本

启动本地 Web 工具：

```powershell
python .\run_web.py
```

然后打开：

```text
http://127.0.0.1:8000
```

页面支持：

- 输入视频链接
- 选择本地视频或音频文件
- 勾选输出视频、音频、字幕 / 文稿
- 选择 Whisper 模型
- 切换本地 Whisper 或 MiMo 识别引擎
- 勾选生成小红书风格 / 专业风格文章
- 查看并下载 `outputs/items/<任务名>/video`、`audio`、`transcripts` 里的结果

抖音链接建议保持“使用浏览器抓取模式”开启。

使用 MiMo 时，可以在页面里填写 API Key；也可以先设置环境变量 `MIMO_API_KEY`，页面里的 API Key 留空。

如果要在转写后自动生成文章，勾选“文章”，选择“小红书风格”或“专业风格”。文章会输出到：

```text
outputs/items/<任务名>/articles/
```

如果觉得文章太短，可以把“文章长度”改成“详细长文”。默认是“长文展开”，会比摘要更充分保留细节。

默认会复用 `MIMO_API_KEY` / `MIMO_BASE_URL` 来调用写稿模型。你也可以单独设置：

```powershell
$env:LLM_API_KEY="你的写稿模型key"
$env:LLM_BASE_URL="https://你的-openai-compatible-base-url/v1"
$env:LLM_MODEL="mimo-v2.5"
```

写作模型预设放在：

```text
config/llm_models.json
```

示例：

```json
{
  "id": "my-model",
  "label": "我的写稿模型",
  "model": "your-model-name",
  "base_url": "https://your-provider.example.com/v1",
  "api_key_env": "LLM_API_KEY",
  "note": "页面里会显示这段提示。"
}
```

一般不建议把真实 API Key 写进 JSON。更稳的做法是把 Key 放进环境变量，然后在 JSON 里通过 `api_key_env` 指定变量名。

指定中文识别：

```powershell
python .\video_to_text.py "https://example.com/video-url" --language zh
```

如果视频需要登录，可以读取浏览器 cookies，例如 Edge：

```powershell
python .\video_to_text.py "https://example.com/video-url" --cookies-from-browser edge
```

也可以先转写本地视频或音频文件：

```powershell
python .\video_to_text.py --input-file "D:\Videos\demo.mp4" --language zh
```

如果你已经有本地文稿，也可以直接拿来生成文章，不需要重新转写：

```powershell
python .\video_to_text.py --input-file ".\demo.txt" --generate-articles --article-length deep
```

支持的文稿格式：`.txt`、`.md`、`.srt`、`.vtt`。

## 输出位置

运行后会生成：

- `outputs/items/<任务名>/video/`：下载的视频
- `outputs/items/<任务名>/audio/`：抽取后的音频
- `outputs/items/<任务名>/transcripts/`：纯文字稿、字幕和 JSON
- `outputs/items/<任务名>/work/`：临时中间文件

## 模型选择

默认使用 `small`，准确率和速度比较均衡。可以按电脑性能调整：

- `tiny`：最快，准确率较低
- `base`：较快，适合粗略转写
- `small`：默认推荐
- `medium`：更准确，但更慢
- `large-v3`：准确率更高，需要更多内存和时间

示例：

```powershell
python .\video_to_text.py "https://example.com/video-url" --model medium --language zh
```

如果你有 NVIDIA 显卡并配置好了 CUDA，可以尝试：

```powershell
python .\video_to_text.py "https://example.com/video-url" --device cuda --compute-type float16 --language zh
```

命令行也可以直接生成文章：

```powershell
python .\video_to_text.py --input-file ".\demo.wav" --language zh --generate-articles --article-styles xiaohongshu,professional
```

想生成更长文章：

```powershell
python .\video_to_text.py --input-file ".\demo.wav" --language zh --generate-articles --article-length deep
```

## 常见问题

如果提示下载失败，通常是平台限制、链接需要登录、或该网站暂不支持。可以先尝试加上：

```powershell
--cookies-from-browser edge
```

### 抖音 / Edge Cookie 报错

抖音经常要求新鲜 Cookie。你可能会看到这两类错误：

- `Could not copy Chrome cookie database`
- `Failed to decrypt with DPAPI`

这是 Windows 读取 Edge/Chrome Cookie 时的常见问题，不是转文字模型的问题。

可以按顺序尝试：

1. 关闭所有 Edge 窗口。
2. 打开任务管理器，结束残留的 `msedge.exe` 进程。
3. 回到项目目录重新运行：

```powershell
python .\video_to_text.py "https://www.douyin.com/video/7632124559117831465" --language zh --model tiny --cookies-from-browser edge
```

如果还是失败，建议手动导出 Netscape 格式的 `cookies.txt`，然后运行：

```powershell
python .\video_to_text.py "https://www.douyin.com/video/7632124559117831465" --language zh --model tiny --cookies .\cookies.txt
```

本项目也提供了一个导出助手。它会打开一个独立浏览器窗口，你在里面登录抖音，然后回到终端按回车：

```powershell
npm install
npm run export:cookies -- --url https://www.douyin.com --output .\cookies\douyin.txt
```

导出后使用：

```powershell
python .\video_to_text.py "https://www.douyin.com/video/7632124559117831465" --language zh --model tiny --cookies .\cookies\douyin.txt
```

如果 `yt-dlp` 仍然提示 `Fresh cookies`，可以改用真实浏览器抓取媒体流：

```powershell
python .\video_to_text.py "https://www.douyin.com/video/7632124559117831465" --language zh --model tiny --browser-download
```

也可以换一个已登录抖音的浏览器，例如 Firefox：

```powershell
python .\video_to_text.py "https://www.douyin.com/video/7632124559117831465" --language zh --model tiny --cookies-from-browser firefox
```

## 接入 MiMo API

如果你想改用你自己的 MiMo API 做音频识别，可以这样：

```powershell
$env:MIMO_API_KEY="你的key"
python .\video_to_text.py --input-file ".\outputs\items\7632124559117831465\audio\7632124559117831465.wav" --backend mimo --mimo-model mimo-v2.5 --language zh
```

可用的 MiMo 音频理解模型目前是：

- `mimo-v2.5`
- `mimo-v2-omni`

官方文档说明它支持 `input_audio`，音频可以用公开 URL 或 Base64 传入。对于本地文件，脚本会自动转成 `data:{MIME};base64,...` 后发送。

如果你的音频较长，云端模型会按音频时长计费，文档里给出的估算是 `音频秒数 * 6.25` tokens 左右，实际以返回为准。

如果遇到 `401 Invalid API Key`，先确认 key 前缀和 base URL 是否匹配：

- `tp-` key 用 `https://token-plan-cn.xiaomimimo.com/v1`
- `sk-` key 用 `https://api.xiaomimimo.com/v1`

注意：`cookies.txt` 等同于你的登录凭证，不要发给别人，也不要上传到公开仓库。

第一次识别会下载 Whisper 模型，耗时会比较久，这是正常的。

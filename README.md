# 游戏录屏拉片 Agent

在 Codex 中打开本仓库，然后提出“分析 work/my-game.mp4，生成帧迹工程”。工作流入口是 AGENTS.md。首版支持移动端超休五轨，最终文件在 outputs/，可通过帧迹的打开工程按钮载入。识别需要可查看本地图片并调用命令的 Codex 会话。

## 本地环境

使用 Node.js 22.17+ 或 24、Python 3、Pillow 和可从命令行调用的 FFmpeg/ffprobe。本机验证使用 Node 24。输出目录所在文件系统需支持硬链接。帧迹启动方式见 replay-studio/README.md。

## 从画面到工程

从项目根目录运行。work/my-game.mp4 是本次输入，抽帧目录需使用新目录。时间范围左闭右开；结束时间不超过视频时长。图片标签是请求的采样秒数，实际落点受视频帧间隔影响。

```sh
python agent/frames.py work/my-game.mp4 work/overview 0 20 1
python agent/frames.py work/my-game.mp4 work/detail 5 7 0.2 --width 480
```

Codex 查看画面、按对应标准生成 work/events.json。以下只演示数据结构，实际文字和时间以输入视频为准。

```json
{
  "profile": "mobile-hypercasual",
  "basis": "开头出现连续的短关卡，每关重复填字操作，结算后出现跨关拼图进度。",
  "events": [
    {"time": 6.5, "track": "加载及教程", "text": "教程｜绿框提示待填位置。", "evidence": "局部回看时，空格周围出现绿色边框。"}
  ]
}
```

```sh
node agent/export-replay.mjs work/my-game.mp4 work/events.json "outputs/my-game 五轨.replay"
```

导出工具保留同名旧文件。再次导出请选择新名称。只把代码、规则和小型验收数据纳入版本控制。运行时的事件文件保留在 work/ 以便检查和修正。

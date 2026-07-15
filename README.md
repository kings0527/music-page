# Music Page

一个无框架、可扩展播放列表的 GitHub Pages 音乐播放器。

线上地址：<https://kings0527.github.io/music-page/>

## 添加歌曲

1. 把音频放入 `audio/`。WAV、MP3、M4A 和 FLAC 会由 Git LFS 管理。
2. 在 `tracks.json` 的 `tracks` 数组追加一项：

```json
{
  "id": "unique-track-id",
  "title": "歌曲名",
  "subtitle": "版本或说明",
  "file": "audio/song.mp3",
  "format": "MP3",
  "duration_seconds": 240.0
}
```

3. 提交并推送到 `main`，GitHub Actions 会自动更新站点。

播放器打开后会尝试播放第一首歌。现代浏览器可能拦截带声音的自动播放，
此时页面会显示醒目的“点击播放”按钮。

## 本地预览与测试

```sh
python3 -m unittest -v tests/test_site.py
python3 -m http.server 8000
```

然后访问 <http://localhost:8000/>。

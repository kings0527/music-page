# Music Page

一个无框架、可扩展播放列表的 GitHub Pages 音乐播放器。

线上地址：<https://kings0527.github.io/music-page/>

## 播放器功能

- 空格键播放或暂停；焦点位于按钮、链接、输入框和原生播放器时不会劫持空格键。
- 顺序、列表循环和随机播放；仅有一首时三种模式都会连续重播。加入多首后，顺序模式在末尾停止，循环模式回到第一首，随机模式继续抽取；播放模式会保存在浏览器中。
- 按当前音频时间同步滚动歌词。
- 本地已有并通过校验的 WAV 会优先播放；没有本地 WAV 时立即播放较小的 AAC，MP3 作为兼容回退。
- 无需按钮：页面会自动把 WAV 与当前浏览器支持的首选压缩版保存到 Cache Storage。
- 缓存音频支持 HTTP Range，离线时仍可播放和拖动进度。
- 页面外壳、播放列表和歌词采用网络优先、离线回退策略。

浏览器可能拦截带声音的自动播放，此时页面会显示“点击播放”按钮。

## 播放和本地缓存策略

当前 WAV 是 48 kHz 双声道 PCM，大小约 45.8 MB；160 kbps AAC（约 4.9 MB）
与 192 kbps MP3（约 5.7 MB）是快速播放与兼容回退版本。页面会先检查本地
是否已有完整且校验通过的 WAV：命中时直接播放本地 WAV，未命中时立即播放
较小的压缩版，同时在后台自动缓存 WAV 与当前浏览器支持的首选压缩版。
音频文件远超 `localStorage` 的常见容量限制，因此使用专门保存网络响应的
Cache Storage；播放模式等小型设置仍使用 `localStorage`。

GitHub Pages 和离线缓存都支持标准 Range 请求，无需把 WAV 手工拆成小文件。
后台缓存不会在完成时打断当前歌曲；下次打开页面会自动优先使用本地 WAV。

## 添加歌曲

1. 把 AAC、MP3 和 WAV 母版放入 `audio/`。
2. 把与该音频严格对齐的时间轴 JSON 放入 `lyrics/`。
3. 在 `tracks.json` 的 `tracks` 数组追加一项：

```json
{
  "id": "unique-track-id",
  "title": "歌曲名",
  "subtitle": "版本或说明",
  "format": "AAC / MP3",
  "duration_seconds": 240.0,
  "sources": [
    {
      "file": "audio/song-stream.m4a",
      "type": "audio/mp4",
      "bitrate_kbps": 160,
      "bytes": 4900000,
      "sha256": "完整的 SHA-256"
    },
    {
      "file": "audio/song-stream.mp3",
      "type": "audio/mpeg",
      "bitrate_kbps": 192,
      "bytes": 5800000,
      "sha256": "完整的 SHA-256"
    }
  ],
  "lyrics": "lyrics/song.json",
  "master": {
    "file": "audio/song.wav",
    "type": "audio/wav",
    "bytes": 46000000,
    "sha256": "完整的 SHA-256"
  }
}
```

示例转码命令：

```sh
ffmpeg -i song.wav -map 0:a:0 -vn -map_metadata -1 \
  -c:a aac -b:a 160k -ar 48000 -ac 2 -movflags +faststart song-stream.m4a

ffmpeg -i song.wav -map 0:a:0 -vn -map_metadata -1 \
  -c:a libmp3lame -b:a 192k -ar 48000 -ac 2 -write_xing 1 song-stream.mp3
```

提交并推送到 `main` 后，GitHub Actions 会验证文件并更新站点。

## 本地预览与测试

```sh
npm test
python3 -m http.server 8000
```

然后访问 <http://localhost:8000/>。Service Worker 只能在 HTTP(S) 页面运行，
不要直接双击打开 `index.html`。

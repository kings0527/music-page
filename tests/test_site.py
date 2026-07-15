import json
import hashlib
from pathlib import Path, PurePosixPath
import unittest


ROOT = Path(__file__).resolve().parents[1]


class MusicPageTests(unittest.TestCase):
    def test_required_site_files_exist(self) -> None:
        for relative_path in (
            "index.html",
            "styles.css",
            "app.js",
            "player-logic.js",
            "lyrics-timeline.js",
            "lyrics-controller.js",
            "cache-client.js",
            "cache-logic.js",
            "cache-controller.js",
            "service-worker.js",
            "tracks.json",
            ".github/workflows/pages.yml",
        ):
            with self.subTest(relative_path=relative_path):
                self.assertTrue((ROOT / relative_path).is_file())

    def test_track_manifest_is_valid_and_files_are_real_audio(self) -> None:
        payload = json.loads((ROOT / "tracks.json").read_text(encoding="utf-8"))
        self.assertEqual(payload["version"], 2)
        self.assertTrue(payload["tracks"])

        track_ids: set[str] = set()
        for track in payload["tracks"]:
            self.assertTrue(
                {
                    "id",
                    "title",
                    "subtitle",
                    "format",
                    "duration_seconds",
                    "sources",
                    "lyrics",
                    "master",
                }
                <= track.keys()
            )
            self.assertNotIn(track["id"], track_ids)
            track_ids.add(track["id"])

            for audio_item in [*track["sources"], track["master"]]:
                relative_audio = PurePosixPath(audio_item["file"])
                self.assertFalse(relative_audio.is_absolute())
                self.assertNotIn("..", relative_audio.parts)
                audio = ROOT.joinpath(*relative_audio.parts)
                self.assertTrue(audio.is_file())
                self.assertGreater(audio.stat().st_size, 1_000_000)
                with audio.open("rb") as handle:
                    self.assertFalse(
                        handle.read(80).startswith(b"version https://git-lfs"),
                    )

    def test_player_loads_manifest_and_attempts_autoplay(self) -> None:
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="player"', html)
        self.assertIn('href="styles.css"', html)
        self.assertIn('type="module" src="app.js"', html)
        self.assertIn('fetch("tracks.json"', javascript)
        self.assertIn("player.play()", javascript)
        self.assertIn('player.addEventListener("error"', javascript)
        self.assertIn("playbackRequestId", javascript)

    def test_synced_lyrics_match_the_published_master_timeline(self) -> None:
        payload = json.loads((ROOT / "tracks.json").read_text(encoding="utf-8"))
        track = payload["tracks"][0]
        lyrics_path = ROOT.joinpath(*PurePosixPath(track["lyrics"]).parts)
        timeline = json.loads(lyrics_path.read_text(encoding="utf-8"))

        master = ROOT.joinpath(*PurePosixPath(track["master"]["file"]).parts)
        self.assertEqual(
            hashlib.sha256(master.read_bytes()).hexdigest(),
            timeline["audio_sha256"],
        )
        self.assertAlmostEqual(timeline["duration_seconds"], track["duration_seconds"])
        self.assertGreaterEqual(len(timeline["cues"]), 20)
        self.assertEqual(timeline["cues"][0]["text"], "小时候问天空有多远")
        self.assertEqual(timeline["cues"][-1]["text"], "让我成为今天的我")
        self.assertTrue(
            all(
                cue["start"] < cue["end"]
                and cue["end"] <= timeline["duration_seconds"]
                for cue in timeline["cues"]
            ),
        )
        self.assertEqual(
            timeline["cues"],
            sorted(timeline["cues"], key=lambda cue: cue["start"]),
        )

    def test_streaming_sources_are_small_and_content_addressed(self) -> None:
        payload = json.loads((ROOT / "tracks.json").read_text(encoding="utf-8"))
        track = payload["tracks"][0]
        self.assertEqual([source["type"] for source in track["sources"]], [
            "audio/mp4",
            "audio/mpeg",
        ])

        for source in track["sources"]:
            stream = ROOT.joinpath(*PurePosixPath(source["file"]).parts)
            self.assertEqual(stream.stat().st_size, source["bytes"])
            self.assertEqual(hashlib.sha256(stream.read_bytes()).hexdigest(), source["sha256"])
            self.assertLess(source["bytes"], track["master"]["bytes"] / 5)

    def test_service_worker_supports_offline_audio_repair_and_ranges(self) -> None:
        for relative_path in (
            "cache-client.js",
            "cache-logic.js",
            "service-worker.js",
        ):
            self.assertTrue((ROOT / relative_path).is_file())

        cache_controller = (ROOT / "cache-controller.js").read_text(encoding="utf-8")
        worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
        self.assertIn("registerServiceWorker", cache_controller)
        self.assertIn('case "CACHE_TRACK"', worker)
        self.assertIn('case "CHECK_TRACK"', worker)
        self.assertIn("repairRequired", worker)
        self.assertIn("result.repairRequired", cache_controller)
        self.assertIn('searchParams.set("music-reload"', cache_controller)
        self.assertIn('searchParams.delete("music-reload"', worker)
        self.assertIn("AUDIO_DOWNLOADS", worker)
        self.assertIn("parseByteRange", worker)
        self.assertIn("Content-Range", worker)

    def test_page_exposes_modes_keyboard_auto_cache_and_synchronized_lyrics(self) -> None:
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        cache_controller = (ROOT / "cache-controller.js").read_text(encoding="utf-8")
        lyrics_controller = (ROOT / "lyrics-controller.js").read_text(encoding="utf-8")
        for mode in ("order", "loop", "shuffle"):
            self.assertIn(f'data-play-mode="{mode}"', html)
        self.assertNotIn('id="cache-track"', html)
        self.assertIn('id="cache-status"', html)
        self.assertIn('id="lyrics"', html)
        self.assertIn('id="master-download"', html)
        self.assertIn('addEventListener("keydown"', app)
        self.assertIn("shouldHandlePlaybackShortcut", app)
        self.assertIn("cacheController.chooseInitialSource(", app)
        self.assertIn("[...track.sources, track.master]", app)
        self.assertIn("cacheController.setSources(", app)
        self.assertIn("[compressedSource, track.master]", app)
        self.assertIn("player.loop = tracks.length === 1", app)
        self.assertIn("masterDownload.href = versionedSourceUrl(track.master)", app)
        self.assertIn("cacheAll", cache_controller)
        self.assertIn('addEventListener("timeupdate"', lyrics_controller)
        self.assertIn("findActiveCueIndex", lyrics_controller)
        self.assertIn('"CACHE_TRACK"', cache_controller)

    def test_pages_workflow_downloads_lfs_and_deploys(self) -> None:
        workflow = (ROOT / ".github/workflows/pages.yml").read_text(encoding="utf-8")
        self.assertIn("lfs: true", workflow)
        self.assertIn("actions/checkout@v7", workflow)
        self.assertIn("actions/configure-pages@v6", workflow)
        self.assertIn("actions/upload-pages-artifact@v5", workflow)
        self.assertIn("actions/deploy-pages@v5", workflow)
        self.assertIn("node --test tests/*.test.mjs", workflow)
        for asset in (
            "lyrics-timeline.js",
            "lyrics-controller.js",
            "cache-client.js",
            "cache-logic.js",
            "cache-controller.js",
            "service-worker.js",
        ):
            self.assertIn(asset, workflow)
        self.assertIn("lyrics/. _site/lyrics/", workflow)


if __name__ == "__main__":
    unittest.main()

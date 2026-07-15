import json
from pathlib import Path, PurePosixPath
import unittest


ROOT = Path(__file__).resolve().parents[1]


class MusicPageTests(unittest.TestCase):
    def test_required_site_files_exist(self) -> None:
        for relative_path in (
            "index.html",
            "styles.css",
            "app.js",
            "tracks.json",
            ".github/workflows/pages.yml",
        ):
            with self.subTest(relative_path=relative_path):
                self.assertTrue((ROOT / relative_path).is_file())

    def test_track_manifest_is_valid_and_files_are_real_audio(self) -> None:
        payload = json.loads((ROOT / "tracks.json").read_text(encoding="utf-8"))
        self.assertEqual(payload["version"], 1)
        self.assertTrue(payload["tracks"])

        track_ids: set[str] = set()
        for track in payload["tracks"]:
            self.assertTrue(
                {"id", "title", "subtitle", "file", "format", "duration_seconds"}
                <= track.keys()
            )
            self.assertNotIn(track["id"], track_ids)
            track_ids.add(track["id"])

            relative_audio = PurePosixPath(track["file"])
            self.assertFalse(relative_audio.is_absolute())
            self.assertNotIn("..", relative_audio.parts)
            audio = ROOT.joinpath(*relative_audio.parts)
            self.assertTrue(audio.is_file())
            self.assertGreater(audio.stat().st_size, 1_000_000)
            with audio.open("rb") as handle:
                self.assertFalse(handle.read(80).startswith(b"version https://git-lfs"))

    def test_player_loads_manifest_and_attempts_autoplay(self) -> None:
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn('<audio id="player"', html)
        self.assertIn('href="styles.css"', html)
        self.assertIn('src="app.js"', html)
        self.assertIn('fetch("tracks.json")', javascript)
        self.assertIn("player.play()", javascript)

    def test_pages_workflow_downloads_lfs_and_deploys(self) -> None:
        workflow = (ROOT / ".github/workflows/pages.yml").read_text(encoding="utf-8")
        self.assertIn("lfs: true", workflow)
        self.assertIn("actions/configure-pages@v5", workflow)
        self.assertIn("actions/upload-pages-artifact@v3", workflow)
        self.assertIn("actions/deploy-pages@v5", workflow)


if __name__ == "__main__":
    unittest.main()

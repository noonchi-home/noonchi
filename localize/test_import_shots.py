import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from import_shots import NoUploads, make_rows


def jpeg(w, h, value=128):
    return cv2.imencode(".jpg", np.full((h, w, 3), value, np.uint8))[1].tobytes()


SCENES = {
    "living_standby_C": dict(id="living_standby_C", position=[6.98, 1.15, 6.38], yaw_deg=58., pitch_deg=-10., vfov_deg=40,
                             width=192, height=108, file="living_standby_C.png", depth_file="living_standby_C.depth.png",
                             depth_encoding="axial_mm_rg16", home="mokryeon_180b"),
    "sink_front_C": dict(id="sink_front_C", position=[6.52, 1.15, .69], yaw_deg=180., pitch_deg=-10., vfov_deg=40,
                         width=192, height=108, file="sink_front_C.png", depth_file="sink_front_C.depth.png",
                         depth_encoding="axial_mm_rg16", home="mokryeon_180b"),
}


def shot(scene, stamp):
    return dict(photo=f"shots/{scene}/{stamp}.jpg", file=f"/api/shots/file?pathname=shots/{scene}/{stamp}.jpg",
                meta=dict(scene_id=scene, captured_at=f"2026-11-23T10:00:{stamp}Z"))


class ImportShots(unittest.TestCase):
    def run_rows(self, shots, photos):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "real"
            scenes_dir = Path(tmp) / "scenes"
            rows, report = make_rows(shots, SCENES, lambda s: photos[s["photo"]], out, scenes_dir)
            for row in rows:
                image = cv2.imdecode(np.fromfile(out / row["file"], np.uint8), cv2.IMREAD_COLOR)
                self.assertEqual(image.shape[:2], (row["height"], row["width"]))
            return rows, report

    def test_takes_pose_depth_and_missing_scenes(self):
        shots = [shot("living_standby_C", "01"), shot("living_standby_C", "02")]
        rows, report = self.run_rows(shots, {s["photo"]: jpeg(1920, 1080) for s in shots})
        self.assertEqual([r["id"] for r in rows], ["living_standby_C__1", "living_standby_C__2"])
        self.assertEqual(rows[0]["position"], SCENES["living_standby_C"]["position"])
        self.assertTrue(rows[0]["depth_file"].endswith("scenes/living_standby_C.depth.png"))
        self.assertEqual(report["scenes_without_photos"], ["sink_front_C"])

    def test_unknown_scene_and_other_aspect_are_skipped(self):
        shots = [shot("old_scene", "01"), shot("sink_front_C", "02")]
        rows, report = self.run_rows(shots, {shots[0]["photo"]: jpeg(1920, 1080), shots[1]["photo"]: jpeg(1440, 1080)})
        self.assertEqual(rows, [])
        self.assertEqual(report["unknown_scene"], ["old_scene"])
        self.assertEqual(len(report["bad_aspect"]), 1)

    def test_no_uploads_is_a_clear_error(self):
        with self.assertRaises(NoUploads):
            self.run_rows([], {})


if __name__ == "__main__":
    unittest.main()

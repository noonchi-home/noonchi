import unittest
import numpy as np
from geometry import axes, intrinsics, backproject, estimate


class CameraGeometry(unittest.TestCase):
    def test_camera_resection(self):
        row = dict(width=640, height=360, vfov_deg=40, position=[3, 1.15, 8], yaw_deg=156, pitch_deg=-24)
        k = intrinsics(row)
        rng = np.random.default_rng(12)
        uv = rng.uniform([10, 10], [630, 350], (70, 2))
        xyz = backproject(row, k, uv, rng.uniform(1, 6, len(uv)))
        pose = estimate(xyz, uv, k, (640, 360))
        np.testing.assert_allclose(pose["position"], row["position"], atol=0.001)
        self.assertAlmostEqual(pose["yaw_deg"], 156, places=3)
        self.assertAlmostEqual(pose["pitch_deg"], -24, places=3)

    def test_rejects_collapsed_support(self):
        self.assertIsNone(estimate(np.ones((24, 3)), np.ones((24, 2)), np.eye(3), (640, 360)))

    def test_off_axis_projection(self):
        p = [0.] * 16
        p[0], p[5], p[8], p[9] = 1.5, 2., .1, -.2
        k = intrinsics(dict(width=800, height=400, projection=p))
        np.testing.assert_allclose(k, [[600, 0, 359.5], [0, 400, 159.5], [0, 0, 1]])

if __name__ == "__main__":
    unittest.main()

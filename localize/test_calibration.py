import unittest
from map import select_pose

class PoseGate(unittest.TestCase):
    def test_filters_before_ranking(self):
        fit = dict(matches=12, rms_px=0.8, confidence=.8, position=[1,2,3])
        bad = {**fit, "matches":40,"rms_px":1.1}
        self.assertIs(select_pose([bad, fit], 12, .8), fit)
        self.assertIsNone(select_pose([fit], 13, 1))
        self.assertIsNone(select_pose([fit], 10, .79))

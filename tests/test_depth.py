import unittest
from importlib.util import find_spec
from struct import unpack

from spatium.depth import encode_depth


@unittest.skipUnless(find_spec("numpy"), "depth extra required")
class DepthTests(unittest.TestCase):
    def test_encoding(self):
        import numpy as np
        values = unpack("<4H", encode_depth(np.array([[0., 1.], [2., 3.]])))
        self.assertEqual(values[0], 65535)
        self.assertEqual(values[-1], 0)
        self.assertGreater(values[1], values[2])
        for invalid in ([1, 1], [1, np.nan], [1, np.inf]):
            with self.assertRaises(ValueError):
                encode_depth(np.array(invalid))

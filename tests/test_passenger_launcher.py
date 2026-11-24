"""The kiosk must not silently serve a build older than its source."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location(
    'passenger_launcher', Path(__file__).parents[1] / 'scripts/launch-passenger-gui.py')
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


class ProductionBuildTests(unittest.TestCase):
    def test_missing_stale_and_current_build(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'src' / 'app.tsx'
            source.parent.mkdir()
            source.write_text('old')
            self.assertFalse(launcher.production_build_is_current(root))
            build = root / '.next' / 'BUILD_ID'
            build.parent.mkdir()
            build.write_text('build')
            os.utime(source, ns=(1_000_000_000, 1_000_000_000))
            os.utime(build, ns=(2_000_000_000, 2_000_000_000))
            self.assertTrue(launcher.production_build_is_current(root))
            os.utime(source, ns=(3_000_000_000, 3_000_000_000))
            self.assertFalse(launcher.production_build_is_current(root))


if __name__ == '__main__':
    unittest.main()

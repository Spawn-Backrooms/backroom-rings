import contextlib
import importlib.util
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("compare_package", Path(__file__).with_name("compare-package.py"))
comparator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparator)

MANIFEST = ("package/package.json", b'{"name":"fixture","version":"1.0.0"}', 0o644)
SOURCE = ("package/main.js", b"ok", 0o644)


def archive_at(path, members):
    with tarfile.open(path, "w:gz") as archive:
        for name, content, mode in members:
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode = len(content), mode
            archive.addfile(entry, io.BytesIO(content))


class PackageComparisonTests(unittest.TestCase):
    def test_inventory_requires_unique_regular_portable_paths_and_manifest(self):
        file = ("package/parent", b"a", 0o644)
        child = ("package/parent/child", b"b", 0o644)
        invalid = [[SOURCE], [MANIFEST, MANIFEST], [MANIFEST, file, child], [MANIFEST, child, file]]
        for name in ["/package/file", "package/../file", "package/./file", "package//file", r"package/a\b"]:
            invalid.append([MANIFEST, (name, b"x", 0o644)])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pack.tgz"
            for members in invalid:
                with self.subTest(names=[m[0] for m in members]):
                    archive_at(path, members)
                    with self.assertRaises(ValueError):
                        comparator.inventory(path)

    def test_comparison_identifies_added_removed_content_and_mode_independently(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "reference.tgz"
            archive_at(reference, [MANIFEST, SOURCE])
            groups = [
                ("removed", [MANIFEST], SOURCE[0]),
                ("added", [MANIFEST, SOURCE, ("package/new", b"n", 0o644)], "package/new"),
                ("changed", [MANIFEST, (SOURCE[0], b"different", SOURCE[2])], SOURCE[0]),
                ("changed", [MANIFEST, (SOURCE[0], SOURCE[1], 0o755)], SOURCE[0]),
            ]
            for group, members, name in groups:
                with self.subTest(group=group, members=members):
                    def pack(args, **kwargs):
                        archive_at(Path(args[-1]) / "candidate.tgz", members)
                        return subprocess.CompletedProcess(args, 0, stdout='[{"filename":"candidate.tgz"}]')
                    output = io.StringIO()
                    with patch.object(comparator.subprocess, "run", side_effect=pack), contextlib.redirect_stdout(output):
                        self.assertEqual(comparator.compare(Path(directory), reference), 1)
                    result = json.loads(output.getvalue())
                    self.assertFalse(result["archiveMatches"])
                    self.assertEqual(result[group], [name])
                    for other in {"added", "removed", "changed"} - {group}:
                        self.assertEqual(result[other], [])


if __name__ == "__main__":
    unittest.main()

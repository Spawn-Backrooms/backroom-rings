"""Compare a local npm archive with a fresh pack from a built Backrooms checkout."""

import argparse
import base64
import hashlib
import json
import subprocess
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


def inventory(path):
    data = path.read_bytes()
    identity = {
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "integrity": "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode(),
    }
    files = {}
    directories = set()
    with tarfile.open(path, "r:gz") as archive:
        for entry in archive:
            name = PurePosixPath(entry.name)
            if (not entry.isfile() or len(name.parts) < 2 or name.parts[0] != "package"
                    or ".." in name.parts or "\\" in entry.name or str(name) != entry.name
                    or entry.name in files or entry.name in directories):
                raise ValueError(f"unexpected npm archive entry: {entry.name!r}")
            for parent in name.parents:
                if str(parent) in files:
                    raise ValueError(f"file used as an npm archive directory: {parent!s}")
                directories.add(str(parent))
            with archive.extractfile(entry) as stream:
                files[entry.name] = (entry.mode, hashlib.file_digest(stream, "sha256").hexdigest())
    if "package/package.json" not in files:
        raise ValueError("archive lacks package/package.json")
    identity["files"] = len(files)
    return identity, files


def compare(package_root, reference):
    expected, old = inventory(reference)
    with tempfile.TemporaryDirectory() as directory:
        result = subprocess.run(
            ["npm", "pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", directory],
            cwd=package_root, check=True, stdout=subprocess.PIPE, text=True,
        )
        [pack] = json.loads(result.stdout)
        actual, new = inventory(Path(directory) / pack["filename"])
    matches = actual == expected and new == old
    print(json.dumps({
        "archiveMatches": matches, "reference": expected, "rebuild": actual,
        "added": sorted(new.keys() - old.keys()), "removed": sorted(old.keys() - new.keys()),
        "changed": sorted(name for name in old.keys() & new.keys() if old[name] != new[name]),
    }, indent=2))
    return 0 if matches else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path, help="trusted reference .tgz")
    parser.add_argument("--package-root", type=Path, default=Path.cwd(),
                        help="built package directory (default: current directory)")
    args = parser.parse_args()
    raise SystemExit(compare(args.package_root, args.reference))

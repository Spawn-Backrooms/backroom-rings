#!/usr/bin/env python3
"""Verify and apply the complete experimental overlay to an exact clean base."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def git(checkout, *args):
    return subprocess.check_output(
        ["git", "-C", str(checkout), *args], text=True, stderr=subprocess.PIPE
    ).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path, help="clean recursive Custom Rings checkout")
    parser.add_argument("--apply", action="store_true", help="apply after all preflight checks pass")
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    manifest = json.loads((directory / "application-core.manifest.json").read_text())
    if manifest["schema"] != 1:
        raise ValueError("unsupported overlay manifest schema")
    patch_name = Path(manifest["patch"])
    if patch_name.name != str(patch_name):
        raise ValueError("manifest patch must be a filename")
    patch = directory / patch_name
    if hashlib.sha256(patch.read_bytes()).hexdigest() != manifest["patchSha256"]:
        raise ValueError("overlay patch digest does not match its manifest")
    checkout = args.checkout.resolve(strict=True)
    if Path(git(checkout, "rev-parse", "--show-toplevel")).resolve() != checkout:
        raise ValueError("checkout must name the repository root")
    if git(checkout, "rev-parse", "HEAD") != manifest["customRingBase"]:
        raise ValueError("Custom Rings HEAD does not match the exact base pin")
    if git(checkout, "rev-parse", "HEAD:zolana") != manifest["zolanaBase"]:
        raise ValueError("Zolana gitlink does not match the exact base pin")
    if git(checkout / "zolana", "rev-parse", "HEAD") != manifest["zolanaBase"]:
        raise ValueError("initialize the exact pinned Zolana submodule first")
    for source in (checkout, checkout / "zolana"):
        if git(source, "status", "--porcelain=v1", "--untracked-files=all"):
            raise ValueError(f"refusing to modify a dirty checkout: {source}")
    for name in manifest["files"]:
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("manifest contains an unsafe file path")
        (checkout / relative).resolve().relative_to(checkout)
    git(checkout, "apply", "--check", "--whitespace=error-all", str(patch))
    if not args.apply:
        print(f"Verified exact pins, clean checkout, patch SHA-256 and applicability ({len(manifest['files'])} files).")
        print("Use --apply to install this experimental overlay.")
        return
    git(checkout, "apply", "--whitespace=error-all", str(patch))
    for name, expected in manifest["files"].items():
        if hashlib.sha256((checkout / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"post-apply content digest mismatch: {name}; retain the checkout for diagnosis")
    print(f"Applied and verified all {len(manifest['files'])} files. No keys or services were started.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"Overlay refused: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr.rstrip(), file=sys.stderr)
        raise SystemExit(1)

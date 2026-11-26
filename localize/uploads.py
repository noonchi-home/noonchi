"""Import a local export of the shooting app's shots/<scene>/<stamp>.{jpg,json}."""
import argparse
import json
import os
from pathlib import Path


def manifest(root, output, home, calibrations):
    rows = []
    for meta_file in sorted(root.rglob("*.json")):
        meta = json.loads(meta_file.read_text(encoding="utf-8-sig"))
        if not isinstance(meta, dict) or "photo" not in meta or "scene_id" not in meta:
            continue
        photo = meta_file.with_suffix(".jpg")
        if not photo.is_file():
            raise ValueError(f"missing photo for {meta_file}")
        # scene pose/FOV in the app are shooting instructions. A real calibration
        # is indexed by the specific exposure, since several retakes can coexist.
        camera = calibrations.get(meta["photo"], meta.get("measured_camera"))
        if not camera or "position" not in camera or not {"pitch_deg","yaw_deg"} <= camera.keys():
            raise ValueError(f"missing measured camera: {meta['photo']}")
        if "projection" not in camera and "vfov_deg" not in camera:
            raise ValueError(f"missing measured intrinsics: {meta['photo']}")
        width, height = meta["photo_width"], meta["photo_height"]
        if camera.get("width", width) != width or camera.get("height", height) != height:
            raise ValueError("calibration and exposure dimensions disagree")
        rows.append({**camera, "id":meta["photo"], "station_id":meta["scene_id"],
                     "file":os.path.relpath(photo, output.parent), "home":home,
                     "width":width, "height":height})
    if not rows:
        raise ValueError("no uploaded JPEG/JSON pairs")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--root", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--home", required=True)
    p.add_argument("--calibration", type=Path)
    args = p.parse_args()
    manifest(args.root, args.output, args.home,
             json.loads(args.calibration.read_text(encoding="utf-8-sig")) if args.calibration else {})

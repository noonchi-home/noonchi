"""Turn the capture app's real photos into a localization map.

Each uploaded photo was taken while matching one twin scene, so it takes that scene's
camera pose and the twin depth render of that scene. Several takes of one scene each
become a reference row. The passcode is read from a file and never printed.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import cv2
import numpy as np

POSE_KEYS = ("position", "yaw_deg", "pitch_deg", "vfov_deg", "projection", "roll_deg")
ASPECT_TOLERANCE = .02


class NoUploads(Exception):
    pass


def fetcher(api, passcode):
    def get(path):
        request = urllib.request.Request(urllib.parse.urljoin(api, path), headers={"x-shots-passcode": passcode})
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    return get


def make_rows(shots, scenes, read_photo, out, scenes_dir):
    """shots: the /api/shots list. scenes: id → scene row with depth_file. read_photo(shot) → JPEG bytes.
    Writes resized photos under out/photos and returns (rows, report)."""
    if not shots:
        raise NoUploads("촬영 앱에 올라온 사진이 아직 없습니다.")
    photos = out / "photos"
    photos.mkdir(parents=True, exist_ok=True)
    takes, rows = {}, []
    report = dict(uploads=len(shots), used=0, unknown_scene=[], bad_aspect=[], bad_image=[], no_depth=[])
    for shot in sorted(shots, key=lambda s: ((s.get("meta") or {}).get("captured_at", ""), s["photo"])):
        meta = shot.get("meta") or {}
        scene_id = meta.get("scene_id") or shot["photo"].split("/")[1]
        scene = scenes.get(scene_id)
        if scene is None:
            report["unknown_scene"].append(scene_id)
            continue
        if not scene.get("depth_file"):
            report["no_depth"].append(scene_id)
            continue
        image = cv2.imdecode(np.frombuffer(read_photo(shot), np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            report["bad_image"].append(shot["photo"])
            continue
        h, w = image.shape[:2]
        if abs(w/h - scene["width"]/scene["height"]) > ASPECT_TOLERANCE*scene["width"]/scene["height"]:
            # A different aspect means a different crop of the field of view: the scene pose would not fit.
            report["bad_aspect"].append(f"{shot['photo']} {w}x{h}")
            continue
        n = takes[scene_id] = takes.get(scene_id, 0) + 1
        row_id = f"{scene_id}__{n}"
        resized = cv2.resize(image, (scene["width"], scene["height"]),
                             interpolation=cv2.INTER_AREA if w > scene["width"] else cv2.INTER_CUBIC)
        cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tofile(str(photos / f"{row_id}.jpg"))
        row = {k: scene[k] for k in POSE_KEYS if k in scene}
        row.update(id=row_id, scene_id=scene_id, file=f"photos/{row_id}.jpg", width=scene["width"], height=scene["height"],
                   depth_file=Path(os.path.relpath(scenes_dir / scene["depth_file"], out)).as_posix(),
                   depth_encoding=scene.get("depth_encoding", "axial_mm_rg16"), source=shot["photo"])
        if scene.get("home"):
            row["home"] = scene["home"]
        rows.append(row)
    report["used"] = len(rows)
    report["scenes_with_photos"] = len(takes)
    report["scenes_without_photos"] = sorted(set(scenes) - set(takes))
    return rows, report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--home", required=True)
    p.add_argument("--api", default="https://home-shots.vercel.app/")
    p.add_argument("--passcode-file", type=Path, required=True)
    p.add_argument("--scenes", type=Path, required=True, help="twin scene manifest with depth renders")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--map", type=Path, help="also build the map here")
    args = p.parse_args()
    passcode = args.passcode_file.read_text(encoding="utf-8").strip()
    get = fetcher(args.api, passcode)
    try:
        listing = json.loads(get("api/shots"))
    except urllib.error.HTTPError as e:
        reason = {401: "팀 비밀번호가 맞지 않습니다.", 503: "촬영 앱 저장소가 설정되지 않았습니다."}.get(e.code, f"촬영 앱 응답 {e.code}")
        print(json.dumps(dict(error=reason), ensure_ascii=False))
        sys.exit(2)
    scenes = {row["id"]: row for row in json.loads(args.scenes.read_text(encoding="utf-8-sig"))}
    try:
        rows, report = make_rows(listing.get("shots", []), scenes, lambda s: get(s["file"].lstrip("/")),
                                 args.out, args.scenes.parent.resolve())
    except NoUploads as e:
        print(json.dumps(dict(error=str(e)), ensure_ascii=False))
        sys.exit(3)
    manifest = args.out / "manifest.json"
    manifest.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.map and rows:
        sys.path.insert(0, str(Path(__file__).parent))
        from map import build
        report["map_revision"] = build(manifest, args.map, args.home)
    report["manifest"] = str(manifest)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()

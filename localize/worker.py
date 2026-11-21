"""Commands for a single home's reference map, JSON-lines worker and held-out evaluation."""
import argparse
import base64
import json
import sys
import time
from pathlib import Path
import cv2
import numpy as np
from map import build, PhotoMap, picture


def solve_bytes(model, encoded, camera):
    image = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("invalid engine image")
    return model.solve(image, camera)


def emit(value):
    print(json.dumps(value, allow_nan=False, separators=(",", ":")), flush=True)


def serve(model):
    emit(dict(ready=True, map_rev=model.revision, references=len(model.refs)))
    for line in sys.stdin.buffer:
        try:
            frame = json.loads(line)
            result = solve_bytes(model, base64.b64decode(frame["jpeg"], validate=True), frame)
        except (ValueError, KeyError, IndexError, TypeError, cv2.error):
            result = None
        emit(dict(result=result))


def peak_mib():
    if sys.platform == "win32":
        import ctypes
        class Counters(ctypes.Structure):
            _fields_ = [("cb", ctypes.c_uint32), ("faults", ctypes.c_uint32)] + [
                (key, ctypes.c_size_t) for key in
                ("peak", "working", "paged_peak", "paged", "nonpaged_peak", "nonpaged", "pagefile", "pagefile_peak")]
        mem = Counters()
        mem.cb = ctypes.sizeof(mem)
        get_memory = ctypes.windll.psapi.GetProcessMemoryInfo
        get_memory.argtypes = [ctypes.c_void_p, ctypes.POINTER(Counters), ctypes.c_uint32]
        if get_memory(ctypes.c_void_p(-1), ctypes.byref(mem), mem.cb):
            return round(mem.peak/2**20, 1)
        return None
    import resource
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(2**20 if sys.platform=="darwin" else 1024), 1)


def evaluate(model, manifest, output, width):
    records = json.loads(manifest.read_text(encoding="utf-8-sig"))
    results = []
    for ref in records:
        image = picture(manifest.parent / ref["file"])
        # Standard engine JPEG, not the original reference PNG. Only intrinsics
        # and compressed pixels enter solve_bytes. Truth is used after it returns.
        w, h = ref["width"], ref["height"]
        scale = min(1., width/max(w, h))
        size = (round(w*scale), round(h*scale))
        jpeg = cv2.imencode(".jpg", cv2.resize(image, size, interpolation=cv2.INTER_AREA),
                            [cv2.IMWRITE_JPEG_QUALITY, 80])[1]
        camera = {k:ref[k] for k in ("projection", "vfov_deg") if k in ref}
        camera.update(width=size[0], height=size[1])
        start = time.perf_counter()
        pose = solve_bytes(model, jpeg, camera)
        row = dict(id=ref["id"], ms=round(1000*(time.perf_counter()-start), 2), pose=pose)
        if pose:
            row["cm"] = float(100*np.linalg.norm(np.subtract(pose["position"], ref["position"])))
            def forward(p):
                a, b = np.deg2rad([p["yaw_deg"], p["pitch_deg"]])
                return [np.cos(b)*np.cos(a), np.sin(b), np.cos(b)*np.sin(a)]
            row["deg"] = float(np.rad2deg(np.arccos(np.clip(np.dot(forward(pose),forward(ref)), -1, 1))))
        results.append(row)
    known = [r for r in results if r["pose"]]
    def stats(values):
        if not values:
            return None
        return {name:round(float(value), 3) for name, value in
                zip(("median", "p95", "max"), np.percentile(values, [50,95,100]))}
    report = dict(map_rev=model.revision, peak_mib=peak_mib(), engine_width=width, jpeg_quality=80, total=len(results), known=len(known),
                  cm=stats([r["cm"] for r in known]), deg=stats([r["deg"] for r in known]),
                  ms=stats([r["ms"] for r in results]))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(dict(**report, frames=results), indent=2), encoding="utf-8")
    emit(report)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["build", "serve", "evaluate"])
    p.add_argument("--home", required=True)
    p.add_argument("--bucket", help="private S3 map bucket (optional)")
    p.add_argument("--map", type=Path, required=True)
    p.add_argument("--manifest", type=Path)
    p.add_argument("--report", type=Path)
    p.add_argument("--width", type=int, default=480)
    args = p.parse_args()
    if args.command in ("build", "evaluate") and args.manifest is None:
        p.error("--manifest required")
    if args.command == "build":
        emit(dict(revision=build(args.manifest, args.map, args.home)))
        return
    expected = None
    if args.bucket:
        import boto3
        from storage import fetch_latest
        expected = fetch_latest(boto3.client("s3"), args.bucket, args.home, args.map)
    model = PhotoMap(args.map, args.home)
    if expected and model.revision != expected:
        raise ValueError("wrong map revision")
    if args.command == "serve":
        serve(model)
    elif args.report:
        evaluate(model, args.manifest, args.report, args.width)
    else:
        p.error("--report required")

if __name__ == "__main__":
    main()

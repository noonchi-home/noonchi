"""Offline map creation and CPU-only visual localization."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import cv2
import numpy as np
from geometry import axes, backproject, estimate, intrinsics

cv2.setNumThreads(2)
sift = cv2.SIFT_create(nfeatures=850, contrastThreshold=.008)
matcher = cv2.BFMatcher(cv2.NORM_L2)


def picture(path):
    image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"invalid image: {path}")
    return image


def features(image, row):
    height, width = image.shape[:2]
    if (width, height) != (row["width"], row["height"]):
        raise ValueError("camera and image dimensions disagree")
    scale = min(1., 640/max(width, height))
    size = (round(width*scale), round(height*scale))
    small = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
    thumb = cv2.resize(small, (20, 12), interpolation=cv2.INTER_AREA)
    color = cv2.cvtColor(thumb, cv2.COLOR_BGR2Lab).astype(np.float32)
    color -= color.mean(axis=(0, 1))*.7
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2., tileGridSize=(8, 8)).apply(gray)
    kp, desc = sift.detectAndCompute(gray, None)
    uv = np.array([p.pt for p in kp], np.float32).reshape(-1, 2)
    if desc is None:
        desc = np.empty((0, 128), np.float32)
    ratios = np.array(size)/[width, height]
    k = intrinsics(row)
    k[:2, :2] *= ratios[:, None]
    k[:2, 2] = (k[:2, 2]+.5)*ratios-.5
    return color.flatten(), uv, desc.astype(np.uint8), k, size


def histogram(desc, words):
    if not len(desc):
        return np.zeros(len(words), np.float32)
    matches = matcher.match(desc, words)
    return np.bincount([m.trainIdx for m in matches], minlength=len(words)).astype(np.float32)


def normalize(hist):
    norm = np.linalg.norm(hist, axis=-1, keepdims=True)
    return hist/np.maximum(norm, 1e-8)


def pairs(query, reference):
    if len(query) < 2 or len(reference) < 2:
        return [], []
    choices = [a for a,b in matcher.knnMatch(query, reference, k=2) if a.distance < .77*b.distance]
    # Repeated textures can vote for the same physical point many times.
    unique = {}
    for a in sorted(choices, key=lambda m: m.distance):
        unique.setdefault(a.trainIdx, a.queryIdx)
    return list(unique.values()), list(unique)


def depth_points(root, row, uv, k, size):
    if row.get("depth_encoding") != "axial_mm_rg16":
        raise ValueError("unsupported depth encoding")
    packed = picture(root / row["depth_file"])
    if packed.shape[:2] != (row["height"], row["width"]):
        raise ValueError("depth and color dimensions disagree")
    depth = (packed[:, :, 2].astype(np.uint16) << 8) | packed[:, :, 1]
    h, w = depth.shape
    x, y = np.rint((uv+.5)*[w/size[0], h/size[1]]-.5).astype(int).T
    # Keypoints near silhouettes can fall on either of two surfaces. Keep only
    # stable local depth in a 3x3 neighbourhood (and reject transparent sky).
    kernel = np.ones((3, 3), np.uint8)
    mm = depth[y, x]
    lo, hi = cv2.erode(depth, kernel)[y, x], cv2.dilate(depth, kernel)[y, x]
    valid = (lo > 0) & (hi-lo < np.maximum(60, mm*.035))
    return valid, backproject(row, k, uv[valid], mm[valid]/1000.)


def camera_matrix(row, k):
    rotation = axes(row).T
    return k @ np.column_stack([rotation, -rotation @ row["position"]])


def triangulate(i, rows, entries, globals_):
    row = rows[i]
    _, uv, desc, k, _ = entries[i]
    p1 = camera_matrix(row, k)
    landmarks = {}
    for j in np.argsort(np.mean((globals_-globals_[i])**2, axis=1)):
        other = rows[j]
        baseline = np.linalg.norm(np.subtract(row["position"], other["position"]))
        if not .12 <= baseline <= 5:
            continue
        _, uv2, desc2, k2, _ = entries[j]
        a,b = pairs(desc, desc2)
        if len(a) < 8:
            continue
        p2 = camera_matrix(other, k2)
        homogeneous = cv2.triangulatePoints(p1, p2, uv[a].T, uv2[b].T).T.astype(np.float64)
        for index, second, pt in zip(a, b, homogeneous):
            if index in landmarks or abs(pt[3]) < 1e-8:
                continue
            pt /= pt[3]
            q1, q2 = p1 @ pt, p2 @ pt
            if min(q1[2], q2[2]) <= .1 or max(q1[2], q2[2]) > 20:
                continue
            r1, r2 = pt[:3]-row["position"], pt[:3]-other["position"]
            if np.dot(r1, r2)/(np.linalg.norm(r1)*np.linalg.norm(r2)) > .9994:
                continue
            if max(np.linalg.norm(q1[:2]/q1[2]-uv[index]), np.linalg.norm(q2[:2]/q2[2]-uv2[second])) < 1.5:
                landmarks[index] = pt[:3].copy()
    indices = list(landmarks)
    return desc[indices], np.asarray(list(landmarks.values())).reshape(-1, 3)


def build(manifest, output, home):
    rows = json.loads(manifest.read_text(encoding="utf-8-sig"))
    if not rows or len({r["id"] for r in rows}) != len(rows) or any(r.get("home", home) != home for r in rows):
        raise ValueError("empty, duplicate or wrong-home manifest")
    entries = [features(picture(manifest.parent/r["file"]), r) for r in rows]
    globals_ = np.stack([e[0] for e in entries])
    data = {"globals": globals_, "home": home, "ids": [r["id"] for r in rows],
            "centers": [r["position"] for r in rows]}
    corpus = np.concatenate([e[2] for e in entries])
    if len(corpus) < 10:
        raise ValueError("insufficient image features")
    rng = np.random.default_rng(31)
    words = corpus[rng.choice(len(corpus), min(256, len(corpus)), replace=False)]
    counts = np.stack([histogram(e[2], words) for e in entries])
    idf = np.log((len(rows)+1)/(1+(counts>0).sum(axis=0)))+1
    data.update(words=words, idf=idf, hist=normalize(np.sqrt(counts)*idf))
    for i, (row, (_, uv, desc, k, size)) in enumerate(zip(rows, entries)):
        if row.get("depth_file"):
            mask, xyz = depth_points(manifest.parent, row, uv, k, size)
            desc = desc[mask]
        else:
            desc, xyz = triangulate(i, rows, entries, globals_)
        data[f"d{i}"] = desc
        data[f"p{i}"] = xyz.astype(np.float32)
    if max(len(data[f"d{i}"]) for i in range(len(rows))) < 10:
        raise ValueError("insufficient calibrated overlapping views or depth")
    digest = hashlib.sha256(b"localize-map-v1")
    for key, value in sorted(data.items()):
        digest.update(key.encode())
        digest.update(np.asarray(value).tobytes())
    data["revision"] = digest.hexdigest()[:16]
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".npz", delete=False) as tmp:
        path = Path(tmp.name)
    try:
        np.savez_compressed(path, **data)
        os.replace(path, output)
    finally:
        path.unlink(missing_ok=True)
    return data["revision"]


class PhotoMap:
    def __init__(self, path, home):
        with np.load(path, allow_pickle=False) as data:
            if str(data["home"]) != home:
                raise ValueError("wrong home")
            self.revision = str(data["revision"])
            self.words, self.idf, self.hist = data["words"], data["idf"], data["hist"]
            self.globals = data["globals"]
            self.ids = data["ids"].tolist()
            self.centers = data["centers"]
            self.refs = [(data[f"d{i}"], data[f"p{i}"]) for i in range(len(self.ids))]

    def solve(self, image, camera):
        g, uv, desc, k, size = features(image, camera)
        color = np.mean((self.globals-g)**2, axis=1)
        bag = normalize(np.sqrt(histogram(desc, self.words))*self.idf)
        distance = np.maximum(0., 1-self.hist @ bag)
        # Give both visual words and coarse color a vote. Match local points in
        # only the five shortlisted reference images, irrespective of map size.
        combined = np.log1p(color/50) + 2.5*np.log1p(distance*10)
        candidates = np.argsort(combined)[:5]
        solutions = []
        for i in candidates:
            reference, xyz = self.refs[i]
            a, b = pairs(desc, reference)
            pose = estimate(xyz[b], uv[a], k, size)
            if pose and np.linalg.norm(pose["position"]-self.centers[i]) < 4:
                solutions.append(pose)
        solutions.sort(key=lambda s: (s["matches"], -s["rms_px"]), reverse=True)
        if not solutions:
            return None
        best = solutions[0]
        for rival in solutions[1:]:
            if rival["matches"] >= .8*best["matches"] and np.linalg.norm(np.subtract(rival["position"], best["position"])) > .45:
                return None
        if best["confidence"] < .23:
            return None
        best["rms_px"] *= camera["width"]/size[0]
        return best

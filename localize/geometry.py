"""OpenCV camera axes are right/down/forward; home vectors are [plan X, up, plan Y]."""
import cv2
import numpy as np


def axes(row):
    yaw, pitch = np.deg2rad([row["yaw_deg"], row["pitch_deg"]])
    forward = np.array([np.cos(pitch)*np.cos(yaw), np.sin(pitch), np.cos(pitch)*np.sin(yaw)])
    right = np.array([-np.sin(yaw), 0, np.cos(yaw)])
    down = np.cross(forward, right)
    roll = np.deg2rad(row.get("roll_deg", 0.))
    return np.column_stack([right*np.cos(roll)+down*np.sin(roll),
                            down*np.cos(roll)-right*np.sin(roll), forward])


def intrinsics(row):
    w, h = row["width"], row["height"]
    if "projection" in row:
        p = row["projection"]
        fx, fy = p[0]*w/2, p[5]*h/2
        cx, cy = (1-p[8])*w/2-.5, (1+p[9])*h/2-.5
    else:
        fx = fy = .5*h/np.tan(np.deg2rad(row["vfov_deg"])/2)
        cx, cy = (w-1)/2, (h-1)/2
    if not np.isfinite([fx, fy, cx, cy]).all() or min(fx, fy) <= 0:
        raise ValueError("invalid intrinsics")
    return np.array([[fx, 0., cx], [0., fy, cy], [0., 0., 1.]])


def backproject(row, k, uv, depth):
    rays = np.column_stack([uv, np.ones(len(uv))]) @ np.linalg.inv(k).T
    return (rays*depth[:, None]) @ axes(row).T + row["position"]


def estimate(xyz, uv, k, size):
    xyz = np.ascontiguousarray(xyz, np.float64)
    uv = np.ascontiguousarray(uv, np.float64)
    w, h = size
    if len(xyz) < 10 or (np.ptp(uv, axis=0) < [w*.08, h*.08]).any():
        return None
    ok, rv, tv, inliers = cv2.solvePnPRansac(xyz, uv, k, None, iterationsCount=200,
        reprojectionError=2.5, confidence=.995, flags=cv2.SOLVEPNP_EPNP)
    if not ok or inliers is None or len(inliers) < max(10, len(xyz)*.35):
        return None
    indices = inliers.ravel()
    points, pixels = xyz[indices], uv[indices]
    if cv2.contourArea(cv2.convexHull(pixels.astype(np.float32))) < w*h*.009:
        return None
    rv, tv = cv2.solvePnPRefineLM(points, pixels, k, None, rv, tv)
    rotation = cv2.Rodrigues(rv)[0]
    if np.min((points @ rotation.T + tv.T)[:, 2]) <= 0:
        return None
    projected = cv2.projectPoints(points, rv, tv, k, None)[0].reshape(-1, 2)
    rms = float(np.sqrt(np.mean(np.sum((projected-pixels)**2, axis=1))))
    if not np.isfinite(rms) or rms > 1.9:
        return None
    forward = rotation[2]
    return dict(position=(-rotation.T @ tv).ravel().tolist(),
                yaw_deg=float(np.rad2deg(np.arctan2(forward[2], forward[0]))),
                pitch_deg=float(np.rad2deg(np.arcsin(np.clip(forward[1], -1, 1)))),
                matches=len(indices), rms_px=rms,
                confidence=float(min(1, len(indices)/30)*len(indices)/len(xyz)*np.exp(-rms/3)))

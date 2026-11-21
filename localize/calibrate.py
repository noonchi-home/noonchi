"""Station-disjoint calibration and validation with rendered truth and mirrored controls."""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np
from map import PhotoMap, picture, select_pose


def angle(a, b):
    def forward(row):
        yaw, pitch = np.radians([row["yaw_deg"], row["pitch_deg"]])
        return [np.cos(yaw)*np.cos(pitch), np.sin(pitch), np.sin(yaw)*np.cos(pitch)]
    return float(np.degrees(np.arccos(np.clip(np.dot(forward(a), forward(b)), -1, 1))))


def distance(a, b):
    return float(np.linalg.norm(np.subtract(a["position"], b["position"])))


def measure(model, reference, holdout):
    originals = {r["id"]: r for r in json.loads(reference.read_text(encoding="utf-8-sig"))}
    rows = json.loads(holdout.read_text(encoding="utf-8-sig"))
    # Keep all angles at an identical physical station in the same split.
    split = sorted({tuple(r["position"]) for r in originals.values()})
    validation = set(split[1::3])
    records = []
    for row in rows:
        source_id = row.get("reference_id", row["id"])
        if source_id not in originals:
            raise ValueError(f"missing paired reference for {row['id']}: {source_id}")
        ref = originals[source_id]
        photo = picture(holdout.parent / row["file"])
        w,h = photo.shape[1],photo.shape[0]
        width = min(480, w)
        size = (width, round(h*width/w))
        enc = cv2.imencode(".jpg", cv2.resize(photo,size,interpolation=cv2.INTER_AREA),[cv2.IMWRITE_JPEG_QUALITY,80])[1]
        image = cv2.imdecode(enc,cv2.IMREAD_COLOR)
        camera = {k:row[k] for k in ("vfov_deg","projection") if k in row}
        camera.update(width=size[0],height=size[1])
        truth = {k:row[k] for k in ("position","yaw_deg","pitch_deg")}
        nominal = {k:ref[k] for k in truth}
        nearest = min((other for other in originals.values() if distance(other,ref)>.001),
                      key=lambda other:distance(other,ref))
        record = dict(id=row["id"], station=row["station_id"], validation=tuple(ref["position"]) in validation,
                      truth=truth, nominal=nominal, other_position=nearest["position"],
                      candidates=model.candidates(image,camera), mirror=model.candidates(cv2.flip(image,1),camera))
        records.append(record)
    return records


def score(rows, n, px):
    hits = wrong = mirror = 0
    gaps = []
    for row in rows:
        pose = select_pose(row["candidates"], n, px)
        mirror += int(select_pose(row["mirror"], n, px) is not None)
        if not pose:
            continue
        truth, nominal = row["truth"], row["nominal"]
        # A successful localization must beat the imposed camera shift (10 cm / 4 degrees).
        if distance(pose,truth) > .1 or angle(pose,truth) > 4:
            wrong += 1
            continue
        hits += 1
        offsets = [angle(pose,{**truth,"yaw_deg":truth["yaw_deg"]+delta}) for delta in (-30,30)]
        gaps.append(dict(good_m=max(distance(pose,truth),distance(pose,nominal)),
                         good_deg=max(angle(pose,truth),angle(pose,nominal)),
                         bad_m=distance(pose,{"position":row["other_position"]}), bad_deg=min(offsets)))
    return dict(frames=len(rows), hits=hits, wrong=wrong, unknown=len(rows)-hits-wrong,
                mirrors=len(rows), mirror_accepted=mirror), gaps


def summary(rows,n,px,m,deg):
    counts, gaps = score(rows,n,px)
    counts["ar_tested"] = len(gaps)
    counts["ar_false_alarm"] = sum(g["good_m"]>m or g["good_deg"]>deg for g in gaps)
    counts["ar_missed_translation"] = sum(g["bad_m"]<=m for g in gaps)
    counts["ar_missed_rotation"] = sum(g["bad_deg"]<=deg for g in gaps)
    return counts


def calibrate(rows):
    train=[r for r in rows if not r["validation"]]
    validation=[r for r in rows if r["validation"]]
    trials=[]
    for n in (6,8,10,12,16,20):
        for px in (.5,.75,1.,1.25,1.5,1.9,2.5):
            counts,_=score(train,n,px)
            trials.append(dict(min_matches=n,max_rms_px=px,**counts))
    best = min(trials,key=lambda r:(r["wrong"]+r["mirror_accepted"], -r["hits"], -r["min_matches"],r["max_rms_px"]))
    n, px = best["min_matches"], best["max_rms_px"]
    _,gaps = score(train,n,px)
    good_m=max(g["good_m"] for g in gaps)
    bad_m=min(g["bad_m"] for g in gaps)
    good_deg=max(g["good_deg"] for g in gaps)
    bad_deg=min(g["bad_deg"] for g in gaps)
    # Minimize false alarms plus missed conflicts on an even mix of controls.
    # Nearby stations can overlap the 10 cm camera perturbation. Preserve those
    # cases and report misses. Center the first minimum-error interval.
    def cut(good,bad,step):
        grid=np.arange(0,max(g[good] for g in gaps)+max(g[bad] for g in gaps)+step,step)
        errors=[sum((g[good]>v)+(int(g[bad]<=v)) for g in gaps) for v in grid]
        first=errors.index(min(errors))
        end=first
        while end+1<len(grid) and errors[end+1]==errors[first]:
            end+=1
        return round(float(grid[(first+end)//2]), 2)
    m=cut("good_m","bad_m",.01)
    deg=cut("good_deg","bad_deg",1)
    return dict(limits=dict(min_matches=n,max_rms_px=px,ar_gap_m=m,ar_gap_deg=deg),
                training_gap_ranges=dict(good_m_max=good_m,bad_m_min=bad_m,good_deg_max=good_deg,bad_deg_min=bad_deg),
                training=summary(train,n,px,m,deg),validation=summary(validation,n,px,m,deg),trials=trials)


if __name__ == "__main__":
    p=argparse.ArgumentParser()
    for arg in ("map","reference","holdout","report"):
        p.add_argument("--"+arg,type=Path,required=True)
    p.add_argument("--home",required=True)
    args=p.parse_args()
    model=PhotoMap(args.map,args.home)
    records=measure(model,args.reference,args.holdout)
    report=calibrate(records)
    args.report.write_text(json.dumps(dict(map_rev=model.revision,**report,records=records),indent=2),encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k!="trials"}))

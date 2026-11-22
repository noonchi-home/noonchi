import hashlib
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
import cv2
import numpy as np
from geometry import axes, intrinsics
from map import depth_points, triangulate
from storage import fetch_latest
from uploads import manifest


class MapInput(unittest.TestCase):
    def test_depth_byte_order_and_silhouette(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            img=np.zeros((32,32,3),np.uint8)
            img[:,:16,1:]=[0,1]
            img[:,16:,1:]=[1,2]
            cv2.imencode(".png",img)[1].tofile(root/"depth.png")
            row=dict(depth_file="depth.png",depth_encoding="axial_mm_rg16",width=32,height=32,
                     vfov_deg=40,position=[0,0,0],yaw_deg=0,pitch_deg=0)
            ok,points=depth_points(root,row,np.array([[4,4],[16,16],[20,20]]),intrinsics(row),(32,32))
            self.assertEqual(ok.tolist(),[True,False,True])
            np.testing.assert_allclose(points[:,0],[.256,.513])

    def test_real_rgb_triangulation(self):
        rng=np.random.default_rng(3)
        xyz=rng.uniform([2,-.8,-.6],[4,.8,.6],(30,3))
        desc=rng.integers(0,128,(30,128),dtype=np.uint8)
        rows=[];entries=[]
        for z in [0,.4]:
            row=dict(width=640,height=360,vfov_deg=65,yaw_deg=0,pitch_deg=0,position=[0,0,z])
            k=intrinsics(row)
            camera=(xyz-row["position"]) @ axes(row)
            px=camera @ k.T
            uv=(px[:,:2]/px[:,2:]).astype(np.float32)
            rows.append(row);entries.append((np.ones(3),uv,desc,k,(640,360)))
        desc_out,points=triangulate(0,rows,entries,np.ones((2,3)))
        self.assertEqual(len(points),len(xyz))
        for d,pt in zip(desc_out,points):
            np.testing.assert_allclose(pt,xyz[np.nonzero(np.all(desc==d,axis=1))[0][0]],atol=.001)

    def test_private_cache_keeps_previous_map_on_bad_download(self):
        revision="a"*16
        class Store:
            def get_object(self, Bucket, Key):
                self.key=Key
                return {"Body":BytesIO(json.dumps(dict(revision=revision,sha256=hashlib.sha256(b"new").hexdigest())).encode())}
            def download_file(self, bucket, key, name):
                self.download=key
                Path(name).write_bytes(b"corrupt")
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"map.npz";path.write_bytes(b"old")
            store=Store()
            with self.assertRaises(ValueError): fetch_latest(store,"bucket","one",path)
            self.assertEqual(path.read_bytes(),b"old")
            self.assertEqual(store.download,"homes/one/map/"+revision+".npz")

    def test_upload_uses_measured_camera(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); output=root/"manifest.json"
            (root/"a.jpg").write_bytes(b"jpeg")
            meta=dict(scene_id="kitchen",photo="shots/k/a.jpg",photo_width=480,photo_height=270,vfov_deg=40)
            (root/"a.json").write_text(json.dumps(meta))
            with self.assertRaises(ValueError): manifest(root,output,"one",{})
            k=dict(position=[1,2,3],yaw_deg=30,pitch_deg=-10,vfov_deg=65,width=480,height=270)
            manifest(root,output,"one",{meta["photo"]:k})
            row=json.loads(output.read_text())[0]
            self.assertEqual((row["width"],row["vfov_deg"],row["position"]),(480,65,[1,2,3]))

if __name__ == "__main__":
    unittest.main()

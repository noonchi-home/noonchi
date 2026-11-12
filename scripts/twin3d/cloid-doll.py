# 트윈 안 클로이드 인형(마스코트 미어캣, 빨간 눈가리개)을 만들어 GLB로 낸다.
# 돌리기: npm run heavy -- "\"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe\"" -b --factory-startup -P scripts/twin3d/cloid-doll.py -- --out ui/public/models/cloid-doll.glb [--preview <png>]
# 앞은 +x, 발은 높이 0, 키는 HEIGHT_M(ui/src/twin3d/eye.ts DOLL_HEIGHT와 같다). 재질 이름(doll_fur·doll_belly·doll_dark·doll_brand)마다
# 화면이 토큰 색을 입힌다. 여기 색은 미리 보기용이다. 치수는 키 1을 기준으로 적고 끝에 HEIGHT_M으로 키운다.
import math
import sys

import bpy
from mathutils import Vector

HEIGHT_M = 1.43
PREVIEW = {"doll_fur": (0.66, 0.40, 0.17), "doll_belly": (0.91, 0.78, 0.66), "doll_dark": (0.05, 0.05, 0.05), "doll_brand": (0.38, 0.0, 0.03)}


def arg(name, default=None):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return argv[argv.index(name) + 1] if name in argv else default


bpy.ops.wm.read_factory_settings(use_empty=True)
MATS = {}
for mat_name, rgb in PREVIEW.items():
    m = bpy.data.materials.new(mat_name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = 0.8
    MATS[mat_name] = m

PARTS = []


def done(mat):
    o = bpy.context.active_object
    o.data.materials.append(MATS[mat])
    bpy.ops.object.shade_smooth()
    PARTS.append(o)
    return o


def ball(mat, at, radii, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1, location=at, rotation=rot)
    bpy.context.active_object.scale = radii if isinstance(radii, tuple) else (radii, radii, radii)
    return done(mat)


def limb(mat, a, b, ra, rb):
    """a에서 b까지 가는 끝이 둥근 막대(반지름 ra → rb)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=ra, radius2=rb, depth=d.length, location=(a + b) / 2)
    bpy.context.active_object.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    done(mat)
    ball(mat, tuple(a), ra)
    ball(mat, tuple(b), rb)


def ring(mat, at, major, minor, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_segments=28, minor_segments=10, major_radius=major, minor_radius=minor, location=at, rotation=rot)
    return done(mat)


# 꼬리: 뒤로 길게 끌리고 끝이 검다
TAIL = [(-0.075, 0.105), (-0.15, 0.06), (-0.225, 0.035), (-0.30, 0.022), (-0.36, 0.018)]
TAIL_R = [0.036, 0.031, 0.026, 0.021, 0.014]
for i in range(len(TAIL) - 1):
    (x0, z0), (x1, z1) = TAIL[i], TAIL[i + 1]
    limb("doll_dark" if i == len(TAIL) - 2 else "doll_fur", (x0, 0, z0), (x1, 0, z1), TAIL_R[i], TAIL_R[i + 1])

# 몸: 아래가 넓은 털 몸통 + 앞의 밝은 배
ball("doll_fur", (-0.005, 0, 0.27), (0.105, 0.115, 0.185))
ball("doll_fur", (0.0, 0, 0.50), (0.08, 0.088, 0.18))
ball("doll_belly", (0.032, 0, 0.40), (0.082, 0.068, 0.265))
ball("doll_brand", (0.094, 0, 0.575), (0.007, 0.022, 0.022))

for s in (1, -1):
    # 엉덩이 관절: 털 허벅지, 검은 테, 밝은 원판, 검은 점
    ball("doll_fur", (0.0, 0.085 * s, 0.20), (0.092, 0.06, 0.125))
    ball("doll_dark", (0.0, 0.118 * s, 0.215), (0.083, 0.02, 0.098))
    ball("doll_belly", (0.004, 0.128 * s, 0.215), (0.068, 0.02, 0.082))
    ball("doll_dark", (0.004, 0.147 * s, 0.215), (0.016, 0.006, 0.016))
    # 다리와 발: 밝은 발목, 검은 줄, 검은 발끝
    limb("doll_fur", (0.015, 0.07 * s, 0.13), (0.025, 0.07 * s, 0.085), 0.04, 0.035)
    limb("doll_belly", (0.025, 0.07 * s, 0.075), (0.03, 0.07 * s, 0.035), 0.033, 0.031)
    ring("doll_dark", (0.028, 0.07 * s, 0.055), 0.031, 0.007)
    ball("doll_belly", (0.062, 0.07 * s, 0.022), (0.06, 0.036, 0.022))
    ball("doll_dark", (0.108, 0.07 * s, 0.018), (0.022, 0.03, 0.018))
    # 어깨 관절과 팔: 밝은 어깨, 털 위팔, 검은 팔꿈치 띠, 밝은 아래팔, 검은 손
    ball("doll_belly", (0.0, 0.1 * s, 0.60), 0.04)
    ball("doll_dark", (0.0, 0.138 * s, 0.60), (0.013, 0.006, 0.013))
    limb("doll_fur", (0.0, 0.108 * s, 0.57), (0.005, 0.112 * s, 0.475), 0.03, 0.028)
    ball("doll_dark", (0.008, 0.112 * s, 0.46), 0.032)
    limb("doll_belly", (0.022, 0.1 * s, 0.445), (0.088, 0.05 * s, 0.395), 0.026, 0.023)
    ball("doll_dark", (0.1, 0.04 * s, 0.37), (0.026, 0.024, 0.038))
# 목: 밝은 목에 뒤쪽 검은 줄, 검은 목깃과 빨간 줄
limb("doll_belly", (0.0, 0, 0.66), (0.01, 0, 0.79), 0.042, 0.038)
limb("doll_dark", (-0.016, 0, 0.67), (-0.012, 0, 0.80), 0.034, 0.03)
ring("doll_dark", (0.0, 0, 0.672), 0.05, 0.015)
ring("doll_brand", (0.0, 0, 0.655), 0.062, 0.006)

# 머리: 몸보다 크게(HEAD배, 목 끝 기준). 밝은 얼굴, 털 정수리, 주둥이, 눈 둘레를 감싸는 빨간 눈가리개, 귀
HEAD = 1.2
NECK_TOP = (0.01, 0.0, 0.79)


def head(mat, at, radii):
    p = tuple(NECK_TOP[i] + (at[i] - NECK_TOP[i]) * HEAD for i in range(3))
    return ball(mat, p, tuple(r * HEAD for r in radii))


head("doll_belly", (0.02, 0, 0.865), (0.105, 0.09, 0.085))
head("doll_fur", (-0.012, 0, 0.895), (0.1, 0.089, 0.068))
head("doll_belly", (0.11, 0, 0.836), (0.075, 0.045, 0.036))
head("doll_brand", (0.045, 0, 0.882), (0.09, 0.096, 0.036))
for s in (1, -1):
    head("doll_belly", (0.127, 0.04 * s, 0.886), (0.008, 0.012, 0.017))
    head("doll_belly", (-0.035, 0.088 * s, 0.868), (0.045, 0.016, 0.05))
    head("doll_dark", (-0.035, 0.1 * s, 0.864), (0.028, 0.008, 0.033))

bpy.ops.object.select_all(action="DESELECT")
for o in PARTS:
    o.select_set(True)
bpy.context.view_layer.objects.active = PARTS[0]
bpy.ops.object.join()
body = bpy.context.active_object
body.name = body.data.name = "doll_body"
# 코는 따로 둔다(앞쪽을 가리킨다)
nose = head("doll_dark", (0.183, 0, 0.846), (0.022, 0.024, 0.02))
nose.name = nose.data.name = "doll_nose"

# 발을 높이 0에 놓고 키를 HEIGHT_M으로 맞춘다
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
zs = [(o.matrix_world @ v.co).z for o in (body, nose) for v in o.data.vertices]
lo, hi = min(zs), max(zs)
k = HEIGHT_M / (hi - lo)
for o in (body, nose):
    for v in o.data.vertices:
        v.co = Vector((v.co.x * k, v.co.y * k, (v.co.z - lo) * k))

out = arg("--out")
if out:
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_apply=True)
    print("[cloid-doll] wrote", out, "height", HEIGHT_M, "verts", sum(len(o.data.vertices) for o in (body, nose)))

preview = arg("--preview")
if preview:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x, scene.render.resolution_y = 1400, 700
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    scene.world = world
    # 옆·앞 비스듬히·뒤 비스듬히 세 벌을 나란히 놓고 한 장에 찍는다
    for i, turn in enumerate((0, -50, 140)):
        for o in (body, nose):
            c = o.copy()
            c.data = o.data
            scene.collection.objects.link(c)
            c.rotation_euler = (0, 0, math.radians(turn))
            c.location = (0, 0, 0)
            c.location.x = (i - 1) * 1.3
            c.rotation_euler.z += math.radians(90)
    body.hide_render = nose.hide_render = True
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 4.0
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -6, 1.75)
    cam.rotation_euler = (math.radians(80), 0, 0)
    scene.camera = cam
    scene.render.filepath = preview
    bpy.ops.render.render(write_still=True)
    print("[cloid-doll] preview", preview)

# -*- coding: utf-8 -*-
"""HIVEFALL AI 模型瘦身管线。

raw/<名>.glb（混元 3D 原始输出，约 5 万面 / 40MB）
  -> 按位置焊接顶点 -> 带贴图的 quadric 简化（保 UV）-> 贴图缩小转 JPEG
  -> 归一化（脚底 y=0、x/z 居中、面朝 +z、高度 1）-> assets/models/ai/<名>.glb
并写 manifest.json。

朝向约定：敌我模型在**本地坐标**里都是正面朝 +z。我方单位在场上朝 -z（虫群来的方向）是渲染层转出来的：
squadview 用 unit.facing（= atan2(dx, dz)，默认 π）当 yaw，程序化步兵的枪口也在本地 +z（infantry.js 的 muzzle）。
所以这里**不要**把我方模型烘成 -z，否则接进去会背对虫群。确实需要时 models.json 里写 "front": "-z"。

用法（在项目根目录）：
  tools/ai-models/.venv/Scripts/python tools/ai-models/process.py            # 处理 models.json 里全部
  tools/ai-models/.venv/Scripts/python tools/ai-models/process.py boss_ravager enemy_hulk
"""
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pygltflib
import pymeshlab as ml
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RAW = ROOT / 'assets' / 'models' / 'ai' / 'raw'
OUT = ROOT / 'assets' / 'models' / 'ai'
CFG = HERE / 'models.json'

Image.MAX_IMAGE_PIXELS = None

CT_DTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
TYPE_N = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


# ---------------------------------------------------------------- 读取
def read_accessor(g, blob, idx):
    acc = g.accessors[idx]
    bv = g.bufferViews[acc.bufferView]
    dt = np.dtype(CT_DTYPE[acc.componentType])
    n = TYPE_N[acc.type]
    off = (bv.byteOffset or 0) + (acc.byteOffset or 0)
    stride = bv.byteStride or dt.itemsize * n
    if stride == dt.itemsize * n:
        arr = np.frombuffer(blob, dtype=dt, count=acc.count * n, offset=off)
    else:
        raw = np.frombuffer(blob, dtype=np.uint8, count=stride * acc.count, offset=off).reshape(acc.count, stride)
        arr = raw[:, :dt.itemsize * n].copy().view(dt)
    return arr.reshape(acc.count, n) if n > 1 else arr.copy()


def node_matrix(node):
    if node.matrix:
        return np.array(node.matrix, dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if node.scale:
        m = np.diag(list(node.scale) + [1.0]) @ m
    if node.rotation:
        x, y, z, w = node.rotation
        r = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        r4 = np.eye(4)
        r4[:3, :3] = r
        m = r4 @ m
    if node.translation:
        t = np.eye(4)
        t[:3, 3] = node.translation
        m = t @ m
    return m


def load_raw(path):
    """返回 (V[n,3] 世界坐标, UV[n,2], F[m,3], images dict)。多 mesh/primitive 合并（要求同一材质贴图）。"""
    g = pygltflib.GLTF2().load(str(path))
    blob = g.binary_blob()
    Vs, UVs, Fs = [], [], []
    base = 0
    mat_idx = None

    def walk(ni, parent):
        nonlocal base, mat_idx
        node = g.nodes[ni]
        m = parent @ node_matrix(node)
        if node.mesh is not None:
            for p in g.meshes[node.mesh].primitives:
                v = read_accessor(g, blob, p.attributes.POSITION).astype(np.float64)
                uv = read_accessor(g, blob, p.attributes.TEXCOORD_0).astype(np.float64)
                if p.indices is not None:
                    f = read_accessor(g, blob, p.indices).astype(np.int64).reshape(-1, 3)
                else:
                    f = np.arange(len(v), dtype=np.int64).reshape(-1, 3)
                v = v @ m[:3, :3].T + m[:3, 3]
                Vs.append(v); UVs.append(uv); Fs.append(f + base)
                base += len(v)
                if mat_idx is None:
                    mat_idx = p.material
        for c in (node.children or []):
            walk(c, m)

    scene = g.scenes[g.scene or 0]
    for ni in scene.nodes:
        walk(ni, np.eye(4))

    def image_of(tex_info):
        if tex_info is None:
            return None
        src = g.textures[tex_info.index].source
        im = g.images[src]
        bv = g.bufferViews[im.bufferView]
        data = blob[(bv.byteOffset or 0):(bv.byteOffset or 0) + bv.byteLength]
        return Image.open(io.BytesIO(data))

    mat = g.materials[mat_idx]
    pbr = mat.pbrMetallicRoughness
    images = {
        'base': image_of(pbr.baseColorTexture),
        'mr': image_of(pbr.metallicRoughnessTexture),
        'normal': image_of(mat.normalTexture),
    }
    factors = {'metallic': pbr.metallicFactor, 'roughness': pbr.roughnessFactor}
    return np.vstack(Vs), np.vstack(UVs), np.vstack(Fs), images, factors


# ---------------------------------------------------------------- 简化
def simplify(V, UV, F, target):
    """焊接 UV 接缝处的重复顶点后做带贴图的 quadric 简化；返回按 (顶点,uv) 重新拆分的网格。"""
    ms = ml.MeshSet()
    ms.add_mesh(ml.Mesh(vertex_matrix=V, face_matrix=F.astype(np.int32), v_tex_coords_matrix=UV))
    ms.compute_texcoord_transfer_vertex_to_wedge()
    ms.meshing_merge_close_vertices(threshold=ml.PercentageValue(0.0001))
    ms.meshing_remove_duplicate_faces()
    ms.meshing_remove_null_faces()
    n0 = ms.current_mesh().face_number()
    if n0 > target:
        ms.meshing_decimation_quadric_edge_collapse_with_texture(
            targetfacenum=int(target), qualitythr=0.5, extratcoordw=1.0,
            preserveboundary=False, boundaryweight=1.0, optimalplacement=True,
            preservenormal=True, planarquadric=False)
    ms.meshing_remove_unreferenced_vertices()
    cm = ms.current_mesh()
    V2 = cm.vertex_matrix()
    F2 = cm.face_matrix().astype(np.int64)
    WT = cm.wedge_tex_coord_matrix().reshape(-1, 3, 2)

    # 平滑法线：在焊接后的拓扑上按面积加权，接缝两侧共用
    tri = V2[F2]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    N2 = np.zeros_like(V2)
    for k in range(3):
        np.add.at(N2, F2[:, k], fn)
    ln = np.linalg.norm(N2, axis=1, keepdims=True)
    N2 = N2 / np.where(ln > 1e-12, ln, 1.0)

    # 按 (顶点索引, 量化 uv) 去重拆分
    corner_v = F2.reshape(-1)
    corner_uv = WT.reshape(-1, 2)
    q = np.round(corner_uv * 16384).astype(np.int64)
    key = np.stack([corner_v, q[:, 0], q[:, 1]], axis=1)
    uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    outV = V2[corner_v[first]]
    outN = N2[corner_v[first]]
    outUV = corner_uv[first]
    outF = inv.reshape(-1, 3)
    return outV, outN, outUV, outF


# ---------------------------------------------------------------- 归一化
def normalize(V, N, yaw_deg):
    if yaw_deg:
        a = np.deg2rad(yaw_deg)
        c, s = np.cos(a), np.sin(a)
        R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
        V = V @ R.T
        N = N @ R.T
    lo, hi = V.min(0), V.max(0)
    raw_size = hi - lo
    center = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    s = 1.0 / raw_size[1]
    V = (V - center) * s
    return V, N, raw_size


# ---------------------------------------------------------------- 贴图
def jpeg_bytes(img, size, quality):
    img = img.convert('RGB')
    if max(img.size) > size:
        img = img.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=quality, optimize=True, subsampling=0 if quality >= 90 else 2)
    return buf.getvalue()


def _glow_weight(a, color):
    """一种发光色的连续权重（0..1）。a = [h,w,3] 0..1 的 sRGB。"""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    if color == 'orange':
        # 虫族腺体 / 眼睛：高饱和、偏橙、够亮（敌方模型一直用的这组阈值，别动）
        return (np.clip((r / np.maximum(g, 1e-3) - 1.15) / 0.25, 0, 1)
                * np.clip((g / np.maximum(b, 1e-3) - 1.3) / 0.4, 0, 1)
                * np.clip((sat - 0.45) / 0.25, 0, 1)
                * np.clip((r - 0.55) / 0.3, 0, 1)
                * (g > 0.2))
    if color == 'orange_hot':
        # 我方的橙色灯 / 喷口：比 orange 更严（要非常亮），免得把橙色警示漆也抠成灯
        return (np.clip((r / np.maximum(g, 1e-3) - 1.15) / 0.25, 0, 1)
                * np.clip((g / np.maximum(b, 1e-3) - 1.3) / 0.4, 0, 1)
                * np.clip((sat - 0.5) / 0.2, 0, 1)
                * np.clip((r - 0.85) / 0.12, 0, 1)
                * np.clip((g - 0.45) / 0.15, 0, 1))
    if color == 'cyan':
        # 我方的青色发光条 / 目镜：g、b 都明显高于 r，且 g 与 b 接近（钴蓝漆是 b 远大于 g，被这一条排除），够亮够饱和
        gb = g / np.maximum(b, 1e-3)
        return (np.clip((np.minimum(g, b) / np.maximum(r, 1e-3) - 1.35) / 0.4, 0, 1)
                * np.clip((gb - 0.72) / 0.12, 0, 1) * np.clip((1.45 - gb) / 0.15, 0, 1)
                * np.clip((sat - 0.4) / 0.2, 0, 1)
                * np.clip((mx - 0.6) / 0.2, 0, 1))
    raise ValueError(f'未知的发光色 {color}')


def emissive_from_base(base, size, colors=('orange',)):
    """从基础色里抠出发光区做自发光贴图。colors：要抠的发光色列表（orange=虫族橙色腺体；cyan / orange_hot=我方青色灯条、橙色灯）。
    返回 (jpeg bytes 或 None, 覆盖率)。"""
    im = base.convert('RGB').resize((size, size), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255.0
    # 连续权重（不是硬阈值），再轻微模糊，避免发光区边缘出现锯齿
    w = np.zeros(a.shape[:2], dtype=np.float32)
    for c in colors:
        w = np.maximum(w, _glow_weight(a, c))
    w = np.asarray(Image.fromarray((w * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32) / 255.0
    cover = float((w > 0.2).mean())
    if cover < 0.0005:
        return None, cover
    em = (a * w[..., None] * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(em).save(buf, 'JPEG', quality=80, optimize=True)
    return buf.getvalue(), cover


# ---------------------------------------------------------------- 写 GLB
def write_glb(path, V, N, UV, F, tex, name, emissive_strength=1.0, double_sided=False):
    chunks = []
    views = []
    accessors = []

    def add_view(data, target=None):
        off = sum(len(c) for c in chunks)
        pad = (-len(data)) % 4
        chunks.append(data + b'\x00' * pad)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    V32 = V.astype('<f4'); N32 = N.astype('<f4'); UV32 = UV.astype('<f4')
    idx_dtype, idx_ct = ('<u2', 5123) if len(V) < 65536 else ('<u4', 5125)
    I = F.astype(idx_dtype).reshape(-1)

    accessors.append({'bufferView': add_view(V32.tobytes(), 34962), 'componentType': 5126, 'count': len(V), 'type': 'VEC3',
                      'min': [float(x) for x in V32.min(0)], 'max': [float(x) for x in V32.max(0)]})
    accessors.append({'bufferView': add_view(N32.tobytes(), 34962), 'componentType': 5126, 'count': len(V), 'type': 'VEC3'})
    accessors.append({'bufferView': add_view(UV32.tobytes(), 34962), 'componentType': 5126, 'count': len(V), 'type': 'VEC2'})
    accessors.append({'bufferView': add_view(I.tobytes(), 34963), 'componentType': idx_ct, 'count': len(I), 'type': 'SCALAR'})

    images, textures = [], []

    def add_tex(data):
        images.append({'bufferView': add_view(data), 'mimeType': 'image/jpeg'})
        textures.append({'sampler': 0, 'source': len(images) - 1})
        return {'index': len(textures) - 1}

    mat = {'name': name, 'doubleSided': bool(double_sided),
           'pbrMetallicRoughness': {'baseColorTexture': add_tex(tex['base']),
                                    'metallicFactor': 1.0, 'roughnessFactor': 1.0}}
    if tex.get('mr'):
        mat['pbrMetallicRoughness']['metallicRoughnessTexture'] = add_tex(tex['mr'])
    else:
        mat['pbrMetallicRoughness'].update({'metallicFactor': 0.0, 'roughnessFactor': 0.7})
    if tex.get('normal'):
        mat['normalTexture'] = add_tex(tex['normal'])
    if tex.get('emissive'):
        mat['emissiveTexture'] = add_tex(tex['emissive'])
        mat['emissiveFactor'] = [emissive_strength] * 3

    bin_data = b''.join(chunks)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'hivefall tools/ai-models/process.py',
                  'copyright': 'Generated with Tencent Hunyuan3D'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': name, 'mesh': 0}],
        'meshes': [{'name': name, 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2},
                                                   'indices': 3, 'material': 0, 'mode': 4}]}],
        'materials': [mat], 'textures': textures, 'images': images,
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_data)}],
    }
    js = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_data)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(bin_data), b'BIN\x00')); f.write(bin_data)
    return total


# ---------------------------------------------------------------- 主流程
def process_one(name, cfg, source):
    src = RAW / f'{name}.glb'
    V, UV, F, images, factors = load_raw(src)
    raw_tris, raw_verts = len(F), len(V)
    V2, N2, UV2, F2 = simplify(V, UV, F, cfg['tris'])
    front = cfg.get('front', '+z')              # 模型本地坐标里正面朝哪：'+z'（渲染层约定，见下）或 '-z'
    V2, N2, raw_size = normalize(V2, N2, cfg.get('yaw', 0) + (180 if front == '-z' else 0))

    size = int(cfg.get('tex', 1024))
    tex = {'base': jpeg_bytes(images['base'], size, cfg.get('quality', 86))}
    aux = int(cfg.get('aux_tex', min(size, 1024)))
    if images['normal'] is not None and cfg.get('normal', True):
        tex['normal'] = jpeg_bytes(images['normal'], aux, 84)
    mr_stats = None
    if images['mr'] is not None and cfg.get('mr', True):
        mr = images['mr'].convert('RGB')
        a = np.asarray(mr.resize((256, 256)))
        mr_stats = {'roughness_mean': round(float(a[..., 1].mean()) / 255, 3), 'metallic_mean': round(float(a[..., 2].mean()) / 255, 3)}
        tex['mr'] = jpeg_bytes(mr, max(256, aux // 2), 80)
    em_cover = 0.0
    em_cfg = cfg.get('emissive', True)          # true = 橙色（虫族）；false = 不抠；或者发光色列表 ["cyan", "orange_hot"]
    if em_cfg:
        em_colors = ('orange',) if em_cfg is True else tuple([em_cfg] if isinstance(em_cfg, str) else em_cfg)
        em, em_cover = emissive_from_base(images['base'], max(256, aux // 2), em_colors)
        if em:
            tex['emissive'] = em

    out = OUT / f'{name}.glb'
    total = write_glb(out, V2, N2, UV2, F2, tex, name, cfg.get('emissive_strength', 1.0), cfg.get('double_sided', False))
    lo, hi = V2.min(0), V2.max(0)
    entry = {
        'name': name, 'file': f'{name}.glb', 'tris': int(len(F2)), 'verts': int(len(V2)),
        'size_kb': round(total / 1024, 1),
        'bbox': {'w': round(float(hi[0] - lo[0]), 4), 'h': round(float(hi[1] - lo[1]), 4), 'd': round(float(hi[2] - lo[2]), 4)},
        'raw': {'tris': int(raw_tris), 'verts': int(raw_verts), 'size_kb': round(src.stat().st_size / 1024, 1),
                'w': round(float(raw_size[0]), 4), 'h': round(float(raw_size[1]), 4), 'd': round(float(raw_size[2]), 4)},
        'textures': {k: round(len(v) / 1024, 1) for k, v in tex.items()},
        'base_tex': size, 'emissive_coverage': round(em_cover, 5), 'mr_stats': mr_stats,
        'front': front, 'origin': '脚底中心 (y=0)，高度归一化为 1',
        'source': source, 'prompt': cfg.get('prompt', ''), 'suggested_logical': cfg.get('suggested_logical', ''),
    }
    print(f"{name}: {raw_tris} -> {entry['tris']} tris, {entry['raw']['size_kb']:.0f}KB -> {entry['size_kb']:.0f}KB, "
          f"bbox {entry['bbox']}, tex {entry['textures']}")
    return entry


def main():
    cfg = json.loads(CFG.read_text(encoding='utf-8'))
    names = sys.argv[1:] or list(cfg['models'].keys())
    mpath = OUT / 'manifest.json'
    manifest = {e['name']: e for e in json.loads(mpath.read_text(encoding='utf-8'))} if mpath.exists() else {}
    for name in names:
        if name not in cfg['models']:
            print(f'跳过 {name}：models.json 里没有'); continue
        if not (RAW / f'{name}.glb').exists():
            print(f'跳过 {name}：raw/{name}.glb 不存在'); continue
        manifest[name] = process_one(name, cfg['models'][name], cfg['source'])
    order = list(cfg['models'].keys())
    items = sorted(manifest.values(), key=lambda e: order.index(e['name']) if e['name'] in order else 999)
    mpath.write_text(json.dumps(items, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'manifest: {mpath} ({len(items)} 项)')


if __name__ == '__main__':
    main()

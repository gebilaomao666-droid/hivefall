# -*- coding: utf-8 -*-
"""
手机版「轻量素材」+ 粒子图集生成器（Python 3 + Pillow + numpy；不进运行时，生成结果随站点发布）。

用法（在项目根目录）：  python tools/make-lite-assets.py
产出：
  assets/lite/env/tex_*_1k.jpg            甲板 / 构件 PBR 贴图 1024 → 512（颜色）/ 256（法线、粗糙度）（文件名保持不变，运行时按原路径映射）
  assets/lite/env/hdri_*_1k.hdr            天空 HDRI 1024x512 → 256x128（RLE 压缩的 Radiance RGBE）
  assets/lite/ui/tex/generated/noise_*.png 平铺噪声 512 → 256
  assets/lite/models/ai/*.glb              AI 模型：内嵌贴图缩到 ≤512 重新编码 JPEG，几何 / 动画原样
  assets/lite/models/{env,vehicles}/*.glb  场景模块件：去切线、法线 int8、UV uint16（KHR_mesh_quantization）
  assets/ui/tex/particles_atlas_1024.jpg   粒子图集（fx.js 原来运行时把 16 张 512 的 PNG 画进 4x4 图集，这里离线画好：16 个请求 → 1 个）
  src/render/lite-manifest.js              手机版有哪些替换文件（运行时 base.js 读它；不在表里的照常用原文件）
改了 env.js 的贴图组 / HDRI、换了 AI 模型、改了 fx.js 的 CELL_FILES 之后重跑一次。
"""
import io, json, os, re, struct, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'assets')
LITE = os.path.join(A, 'lite')
made = []


def out_path(rel):
    p = os.path.join(LITE, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def kb(n):
    return f'{n / 1024:.0f}KB'


# ------------------------------------------------------------------ 贴图
def shrink_jpeg(data, max_side, quality):
    im = Image.open(io.BytesIO(data))
    im.load()
    w, h = im.size
    s = min(1.0, max_side / max(w, h))
    if s < 1:
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=quality, optimize=True, progressive=False)
    return b.getvalue()


def env_textures():
    src = open(os.path.join(ROOT, 'src/render/env.js'), encoding='utf-8').read()
    sets = re.findall(r"loadSet\('([\w-]+)'\)", src)
    for base in sets:
        for kind in ('diff', 'nor_gl', 'arm'):
            rel = f'env/tex_{base}_{kind}_1k.jpg'
            data = open(os.path.join(A, rel), 'rb').read()
            q = 88 if kind == 'nor_gl' else 80      # 法线贴图压狠了会出块状的假凹凸
            out = shrink_jpeg(data, 512 if kind == 'diff' else 256, q)   # 颜色 512；法线 / 粗糙度 256（手机屏上分不出来，又省一半流量）
            open(out_path(rel), 'wb').write(out)
            made.append((rel, len(data), len(out)))
    return re.findall(r"'(hdri_[\w-]+\.hdr)'", src)


# ------------------------------------------------------------------ Radiance HDR（RGBE）读写
def read_hdr(path):
    b = open(path, 'rb').read()
    i = 0
    while True:                                  # 头：一行行直到空行
        j = b.index(b'\n', i)
        line = b[i:j]
        i = j + 1
        if line.strip() == b'':
            break
    j = b.index(b'\n', i)
    m = re.match(rb'-Y (\d+) \+X (\d+)', b[i:j])
    H, W = int(m.group(1)), int(m.group(2))
    i = j + 1
    img = np.zeros((H, W, 4), np.uint8)
    for y in range(H):
        if b[i] == 2 and b[i + 1] == 2 and (b[i + 2] << 8 | b[i + 3]) == W:   # 新式 RLE
            i += 4
            for c in range(4):
                x = 0
                while x < W:
                    n = b[i]; i += 1
                    if n > 128:
                        n -= 128
                        img[y, x:x + n, c] = b[i]; i += 1
                    else:
                        img[y, x:x + n, c] = np.frombuffer(b, np.uint8, n, i); i += n
                    x += n
        else:
            img[y] = np.frombuffer(b, np.uint8, W * 4, i).reshape(W, 4); i += W * 4
    e = img[..., 3].astype(np.int32)
    f = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return img[..., :3].astype(np.float64) * f[..., None]


def write_hdr(path, rgb):
    H, W, _ = rgb.shape
    mx = rgb.max(axis=2)
    mant, ex = np.frexp(mx)
    ok = mx > 1e-32
    sc = np.where(ok, mant * 256.0 / np.where(ok, mx, 1), 0)
    rgbe = np.zeros((H, W, 4), np.uint8)
    rgbe[..., :3] = np.clip(rgb * sc[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(ok, ex + 128, 0).astype(np.uint8)
    out = bytearray(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + f'-Y {H} +X {W}\n'.encode())
    for y in range(H):
        out += bytes([2, 2, W >> 8, W & 255])
        for c in range(4):
            row = rgbe[y, :, c].tobytes()
            x = 0
            while x < W:                          # 连续 ≥3 个相同 → 游程；否则攒字面量（最长 128）
                r = 1
                while x + r < W and r < 127 and row[x + r] == row[x]:
                    r += 1
                if r >= 3:
                    out += bytes([128 + r, row[x]]); x += r; continue
                s = x
                while x < W and x - s < 128:
                    r = 1
                    while x + r < W and r < 3 and row[x + r] == row[x]:
                        r += 1
                    if r >= 3:
                        break
                    x += 1
                out += bytes([x - s]) + row[s:x]
    open(path, 'wb').write(bytes(out))


def hdris(names):
    for n in names:
        rel = 'env/' + n
        src = os.path.join(A, rel)
        rgb = read_hdr(src)
        H, W, _ = rgb.shape
        small = rgb.reshape(H // 4, 4, W // 4, 4, 3).mean(axis=(1, 3))     # 4x4 盒式降采样到 256x128（能量守恒）：只用来做 PMREM 环境光，手机上的反射本来就糊
        write_hdr(out_path(rel), small)
        # 自检：读回来和降采样结果一致（RGBE 量化误差 < 1%）
        back = read_hdr(out_path(rel))
        err = np.abs(back - small).max() / max(1e-6, small.max())
        assert err < 0.01, ('hdr 自检失败', n, err)
        made.append((rel, os.path.getsize(src), os.path.getsize(out_path(rel))))


# ------------------------------------------------------------------ glb：只换内嵌贴图
def pad4(b, fill=b'\0'):
    return b + fill * ((4 - len(b) % 4) % 4)


def shrink_glb(rel, max_side=512):
    data = open(os.path.join(A, rel), 'rb').read()
    magic, ver, total = struct.unpack('<4sII', data[:12])
    assert magic == b'glTF' and ver == 2, rel
    jl, jt = struct.unpack('<II', data[12:20])
    js = json.loads(data[20:20 + jl])
    o = 20 + jl
    bl, bt = struct.unpack('<II', data[o:o + 8])
    bin_ = data[o + 8:o + 8 + bl]
    views = js['bufferViews']
    img_views = {}
    normal_imgs = set()
    for mat in js.get('materials', []):
        nt = mat.get('normalTexture')
        if nt is not None:
            normal_imgs.add(js['textures'][nt['index']]['source'])
    for k, im in enumerate(js.get('images', [])):
        if 'bufferView' in im:
            img_views[im['bufferView']] = k
    new_bin = bytearray()
    for vi, v in enumerate(views):
        chunk = bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        if vi in img_views:
            k = img_views[vi]
            chunk = shrink_jpeg(chunk, max_side, 90 if k in normal_imgs else 80)
            js['images'][k]['mimeType'] = 'image/jpeg'
        while len(new_bin) % 4:
            new_bin.append(0)
        v['byteOffset'] = len(new_bin)
        v['byteLength'] = len(chunk)
        new_bin += chunk
    new_bin = pad4(bytes(new_bin))
    js['buffers'][0]['byteLength'] = len(new_bin)
    jb = pad4(json.dumps(js, separators=(',', ':')).encode(), b' ')
    out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jb) + 8 + len(new_bin)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(new_bin), 0x004E4942) + new_bin
    if len(out) >= len(data) * 0.95:
        return                                   # 省不了多少就不出替换件
    open(out_path(rel), 'wb').write(out)
    made.append((rel, len(data), len(out)))


# ------------------------------------------------------------------ 场景模块件（kitbash）：量化顶点属性
CT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def quantize_glb(rel):
    """kitbash 只读位置 / 法线 / UV / 顶点色（贴图按 256 采样烘成顶点色）：丢掉切线，法线 float32 → int8（KHR_mesh_quantization），
    [0,1] 内的 UV → uint16。three 的 GLTFLoader 原生支持这个扩展，读出来的是 normalized 属性，getX() 自动还原。几何形状不变"""
    data = open(os.path.join(A, rel), 'rb').read()
    jl = struct.unpack('<I', data[12:16])[0]
    js = json.loads(data[20:20 + jl])
    o = 20 + jl
    bl = struct.unpack('<I', data[o:o + 4])[0]
    bin_ = data[o + 8:o + 8 + bl]
    views, accs = js['bufferViews'], js['accessors']
    if any('byteStride' in v for v in views) or any('sparse' in a for a in accs):
        return
    def raw(ai):
        a = accs[ai]; v = views[a['bufferView']]
        n = a['count'] * NCOMP[a['type']]
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(bin_, dtype='<' + CT[a['componentType']], count=n, offset=off).reshape(a['count'], NCOMP[a['type']])
    new_acc = {}      # 访问器序号 → (新数据 bytes, 新 componentType, normalized, byteStride)
    for m in js['meshes']:
        for pr in m['primitives']:
            at = pr['attributes']
            at.pop('TANGENT', None)
            ni = at.get('NORMAL')
            if ni is not None and accs[ni]['componentType'] == 5126 and ni not in new_acc:
                v = raw(ni).astype(np.float64)
                q = np.zeros((len(v), 4), np.int8); q[:, :3] = np.clip(np.round(v * 127), -127, 127)
                new_acc[ni] = (q.tobytes(), 5120, True, 4)
            ui = at.get('TEXCOORD_0')
            if ui is not None and accs[ui]['componentType'] == 5126 and ui not in new_acc:
                v = raw(ui)
                if v.size and v.min() >= 0 and v.max() <= 1:
                    new_acc[ui] = (np.round(v.astype(np.float64) * 65535).astype('<u2').tobytes(), 5123, True, None)
    used = set()
    for m in js['meshes']:
        for pr in m['primitives']:
            used.update(pr['attributes'].values())
            if 'indices' in pr: used.add(pr['indices'])
    for sk in js.get('skins', []):
        if 'inverseBindMatrices' in sk: used.add(sk['inverseBindMatrices'])
    for an in js.get('animations', []):
        for sm in an['samplers']: used.update([sm['input'], sm['output']])
    # 重新排二进制：每个用到的访问器一个视图；图片视图原样保留
    out = bytearray(); nviews = []
    def push(b, extra=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(b)}
        if extra: v.update(extra)
        out.extend(b); nviews.append(v); return len(nviews) - 1
    remap = {}
    for k, im in enumerate(js.get('images', [])):
        if 'bufferView' in im:
            v = views[im['bufferView']]
            im['bufferView'] = push(bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
    for ai, a in enumerate(accs):
        if ai not in used or 'bufferView' not in a:
            continue
        if ai in new_acc:
            b, ct, norm, stride = new_acc[ai]
            a['bufferView'] = push(b, {'byteStride': stride} if stride else None)
            a['componentType'] = ct; a['normalized'] = norm; a.pop('byteOffset', None)
            if ct == 5120: a.pop('min', None); a.pop('max', None)
            elif 'min' in a: a['min'] = [0.0] * NCOMP[a['type']]; a['max'] = [1.0] * NCOMP[a['type']]
        else:
            r = raw(ai)
            a['bufferView'] = push(r.tobytes()); a.pop('byteOffset', None)
    js['bufferViews'] = nviews
    out = pad4(bytes(out)); js['buffers'][0]['byteLength'] = len(out)
    if new_acc:
        for k in ('extensionsUsed', 'extensionsRequired'):
            js[k] = sorted(set(js.get(k, [])) | {'KHR_mesh_quantization'})
    jb = pad4(json.dumps(js, separators=(',', ':')).encode(), b' ')
    res = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jb) + 8 + len(out)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(out), 0x004E4942) + out
    if len(res) >= len(data) * 0.95:
        return
    open(out_path(rel), 'wb').write(res)
    made.append((rel, len(data), len(res)))


def kit_models():
    src = open(os.path.join(ROOT, 'src/render/env.js'), encoding='utf-8').read()
    for part in sorted(set(re.findall(r"'((?:env|vehicles)/[\w.-]+)'", src))):
        if os.path.exists(os.path.join(A, 'models', part + '.glb')):
            quantize_glb('models/' + part + '.glb')



def ai_models():
    d = os.path.join(A, 'models/ai')
    for f in sorted(os.listdir(d)):
        if f.endswith('.glb'):
            shrink_glb('models/ai/' + f)


def small_pngs():
    # 平铺用的噪声图：512 → 256（按 UV 重复采样，图案一样，只是细节少一档）
    for rel in ('ui/tex/generated/noise_fbm_512.png',):
        src = os.path.join(A, rel)
        im = Image.open(src); im.load()
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
        im.save(out_path(rel), optimize=True)
        made.append((rel, os.path.getsize(src), os.path.getsize(out_path(rel))))


# ------------------------------------------------------------------ 粒子图集（所有设备都用）
def particle_atlas():
    src = open(os.path.join(ROOT, 'src/render/fx.js'), encoding='utf-8').read()
    files = re.findall(r"'([\w]+)'", re.search(r'const CELL_FILES = \[(.*?)\]', src).group(1))
    S = 256
    atlas = Image.new('RGB', (S * 4, S * 4), (0, 0, 0))
    for i, f in enumerate(files):
        im = Image.open(os.path.join(A, 'ui/tex/particles_black', f + '.png')).convert('RGBA').resize((S - 8, S - 8), Image.LANCZOS)
        atlas.paste(im, ((i % 4) * S + 4, (i // 4) * S + 4), im)     # 按 alpha 叠到黑底上，和运行时 drawImage 的结果一致
    rel = 'ui/tex/particles_atlas_1024.jpg'      # 黑底加法混合的软粒子：JPEG（4:4:4、q92）看不出差别，比 PNG 小 3 倍
    atlas.save(os.path.join(A, rel), quality=92, subsampling=0, optimize=True)
    made.append((rel, sum(os.path.getsize(os.path.join(A, 'ui/tex/particles_black', f + '.png')) for f in files), os.path.getsize(os.path.join(A, rel))))


def manifest():
    rels = sorted(r for r, _, _ in made if not r.startswith('ui/tex/particles_atlas'))
    body = ',\n'.join(f"  '{r}'" for r in rels)
    js = ('// 由 tools/make-lite-assets.py 生成，别手改。手机（轻量模式）下这些文件改从 assets/lite/ 取（尺寸更小的同名替换件）。\n'
          f'export const LITE_FILES = new Set([\n{body},\n])\n')
    open(os.path.join(ROOT, 'src/render/lite-manifest.js'), 'w', encoding='utf-8', newline='\n').write(js)


if __name__ == '__main__':
    names = env_textures()
    hdris(names)
    ai_models()
    kit_models()
    small_pngs()
    particle_atlas()
    manifest()
    a = sum(x[1] for x in made); b = sum(x[2] for x in made)
    for r, x, y in made:
        print(f'{kb(x):>8} -> {kb(y):>7}  {r}')
    print(f'合计 {kb(a)} -> {kb(b)}，{len(made)} 个文件')

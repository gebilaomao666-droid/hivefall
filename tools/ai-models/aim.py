# -*- coding: utf-8 -*-
"""量武器朝向：处理后的 glb 里，在给定高度段（归一化 0..1）内找离中轴最远的顶点（枪口 / 炮口），打印它的水平方位角。
方位角 0 = +z，正值 = 偏向 +x。把 models.json 的 yaw 设成 -方位角（再重新 process）即可让武器对准 +z。
用法：tools/ai-models/.venv/Scripts/python tools/ai-models/aim.py unit_rifle [ylo yhi]"""
import sys, numpy as np, pygltflib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from process import read_accessor, OUT
name = sys.argv[1]; ylo = float(sys.argv[2]) if len(sys.argv) > 2 else 0.35; yhi = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
g = pygltflib.GLTF2().load(str(OUT / f'{name}.glb')); V = read_accessor(g, g.binary_blob(), 0)
m = (V[:, 1] >= ylo) & (V[:, 1] <= yhi); P = V[m]
r = np.hypot(P[:, 0], P[:, 2]); k = np.argsort(r)[-12:]
for i in k[::-1][:5]:
    x, y, z = P[i]; print(f'r={r[i]:.3f} y={y:.3f} 方位角={np.degrees(np.arctan2(x, z)):+.1f}°')

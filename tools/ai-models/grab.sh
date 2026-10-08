#!/usr/bin/env bash
# 把浏览器刚下载的最新 .glb 挪到 raw/<名>.glb。用法：bash tools/ai-models/grab.sh enemy_hulk
set -e
name="$1"; dl="/c/Users/28772/Downloads"; raw="/d/games/hivefall/assets/models/ai/raw"
for i in $(seq 1 40); do
  if ls "$dl"/*.crdownload >/dev/null 2>&1; then sleep 2; continue; fi
  f=$(ls -t "$dl"/*.glb 2>/dev/null | head -1)
  [ -n "$f" ] && break
  sleep 2
done
[ -z "$f" ] && { echo "没找到 glb"; exit 1; }
mv "$f" "$raw/$name.glb"
ls -la "$raw/$name.glb"

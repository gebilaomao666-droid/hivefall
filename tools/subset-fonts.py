# -*- coding: utf-8 -*-
"""
中文字体按「游戏里实际用到的字」再裁一次（Python 3 + fontTools + brotli）。用法：python tools/subset-fonts.py

原来的 *-subset.woff2 是按 3500 常用字裁的，一个 500~860KB，首页要 3~4 个（Medium / Bold / Black / 站酷庆科黄油体）= 2.4MB。
这里从文案（src 下所有 JS 的字符串字面量 + 两个 HTML 的正文）里收集真正出现的字，各出一份 *-ui.woff2（几十 KB），
assets/ui/fonts/fonts.css 里两份都登记：-ui 那份的 unicode-range 只含这些字、排在后面（优先命中）；
原来那份排在前面兜底——将来新加了文案又忘了重跑本脚本，缺的字会自动从原字体补，不会出现豆腐块（只是多下一个文件）。
改了文案后重跑一次（test-core 会检查文案里的字是否都在 -ui 字体里）。
"""
import io, os, re, sys
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FD = os.path.join(ROOT, 'assets', 'ui', 'fonts')
FONTS = [  # (源文件, 输出, family, weight)
    ('NotoSansSC-Medium-subset.woff2', 'NotoSansSC-Medium-ui.woff2', 'Noto Sans SC', '500'),
    ('NotoSansSC-Bold-subset.woff2', 'NotoSansSC-Bold-ui.woff2', 'Noto Sans SC', '700'),
    ('NotoSansSC-Black-subset.woff2', 'NotoSansSC-Black-ui.woff2', 'Noto Sans SC', '900'),
    ('ZCOOLQingKeHuangYou-subset.woff2', 'ZCOOLQingKeHuangYou-ui.woff2', 'ZCOOL QingKe HuangYou', '400'),
]

STR = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`", re.S)


def strip_comments(src):
    out, i, n = [], 0, len(src)
    while i < n:                                   # 逐字符扫：跳过字符串里的 // 和 /*
        c = src[i]
        if c in '\'"`':
            m = STR.match(src, i)
            if m:
                out.append(m.group(0)); i = m.end(); continue
        if src.startswith('//', i):
            j = src.find('\n', i); i = n if j < 0 else j; continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        out.append(c); i += 1
    return ''.join(out)


def used_chars():
    chars = set()
    for d, _, fs in os.walk(os.path.join(ROOT, 'src')):
        for f in fs:
            if f.endswith('.js'):
                code = strip_comments(open(os.path.join(d, f), encoding='utf-8').read())
                for m in STR.finditer(code):
                    chars.update(m.group(0))
    for d, _, fs in os.walk(os.path.join(ROOT, 'src')):     # CSS 里 content: '‹' 这类伪元素文字也算
        for f in fs:
            if f.endswith('.css'):
                for m in STR.finditer(re.sub(r'/\*.*?\*/', '', open(os.path.join(d, f), encoding='utf-8').read(), flags=re.S)):
                    chars.update(m.group(0))
    for f in ('index.html', 'codex.html'):
        html = open(os.path.join(ROOT, f), encoding='utf-8').read()
        html = re.sub(r'<!--.*?-->', '', html, flags=re.S)
        html = re.sub(r'<script\b[^>]*>(.*?)</script>', lambda m: ' '.join(x.group(0) for x in STR.finditer(strip_comments(m.group(1)))), html, flags=re.S)
        html = re.sub(r'<style\b.*?</style>', '', html, flags=re.S)
        chars.update(re.sub(r'<[^>]+>', ' ', html))
    # 只保留非 ASCII 的（拉丁字母 / 数字由英文字体负责；中文字体里的 ASCII 字形也留着，按需补一小段）
    cjk = {c for c in chars if ord(c) > 0x7f and not c.isspace()}
    cjk.update(chr(c) for c in range(0x20, 0x7f))
    return cjk


def ranges(cps):
    cps = sorted(cps); out = []; s = p = cps[0]
    for c in cps[1:]:
        if c == p + 1:
            p = c; continue
        out.append((s, p)); s = p = c
    out.append((s, p))
    return ', '.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in out)


def main():
    chars = used_chars()
    cps = sorted(ord(c) for c in chars)
    open(os.path.join(FD, 'charset-ui.txt'), 'w', encoding='utf-8', newline='\n').write(''.join(chr(c) for c in cps if c > 0x7f))
    faces = []
    for src, dst, fam, w in FONTS:
        f = TTFont(os.path.join(FD, src))
        have = set(f.getBestCmap().keys())
        keep = [c for c in cps if c in have]
        opt = subset.Options(); opt.flavor = 'woff2'; opt.layout_features = ['*']; opt.name_IDs = ['*']; opt.notdef_outline = True
        sub = subset.Subsetter(opt); sub.populate(unicodes=keep); sub.subset(f)
        f.flavor = 'woff2'; f.save(os.path.join(FD, dst))
        a, b = os.path.getsize(os.path.join(FD, src)), os.path.getsize(os.path.join(FD, dst))
        print(f'{src}: {a // 1024}KB -> {dst}: {b // 1024}KB（{len(keep)} 字）')
        rest = sorted(c for c in have if c > 0x7f and c not in set(keep))
        faces.append((src, dst, fam, w, ranges(keep), ranges(rest)))
    # fonts.css 只登记第一款（Medium）：首屏只用这一个中文字体；粗体 / 特粗由浏览器先合成。
    # 其余三款（Bold / Black / 站酷庆科黄油体）写进 src/ui/fonts-late.js，进首页以后再用 FontFace 加进来（到了自动替换）
    # 兜底那份的 unicode-range = 它有、但 -ui 里没有的字（字体本身就没有的符号谁也不登记，浏览器直接用系统字体，不会白下 500KB）
    css_p = os.path.join(FD, 'fonts.css'); css = open(css_p, encoding='utf-8').read()
    lines = [l for l in css.split('\n') if not any(("url('%s')" % x[0]) in l or ("url('%s')" % x[1]) in l for x in faces)]
    idx = next(i for i, l in enumerate(lines) if l.startswith(':root'))
    src, dst, fam, w, rg, fb = faces[0]
    lines[idx:idx] = [   # -ui 排在后面：浏览器从后往前找第一个 unicode-range 覆盖该字的，文案里的字都落在 -ui 上
        "@font-face{font-family:'%s';src:url('%s') format('woff2');font-weight:%s;font-display:swap;unicode-range:%s}" % (fam, src, w, fb),
        "@font-face{font-family:'%s';src:url('%s') format('woff2');font-weight:%s;font-display:swap;unicode-range:%s}" % (fam, dst, w, rg),
    ]
    open(css_p, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    late = []
    for src, dst, fam, w, rg, fb in faces[1:]:
        late.append("  ['%s', '%s', '%s', '%s']," % (fam, w, src, fb))
        late.append("  ['%s', '%s', '%s', '%s']," % (fam, w, dst, rg))
    js = """// 由 tools/subset-fonts.py 生成，别手改。首屏之后再加载的中文字体（fonts.css 里只有 Medium 一款，粗体先由浏览器合成）。
// loadLateFonts()：用 FontFace 把这些字重加进页面，下载完浏览器自动换上（同一页面只做一次）
const BASE = new URL('../../assets/ui/fonts/', import.meta.url).href
const FACES = [   // [family, weight, 文件, unicode-range]；同一字重里 -ui（文案用字）排在兜底的整份后面
%s
]
let done = false
export function loadLateFonts() {
  if (done || typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return
  done = true
  for (const [family, weight, file, range] of FACES) {
    try {
      const f = new FontFace(family, `url(${BASE}${file}) format('woff2')`, { weight, display: 'swap', unicodeRange: range })
      document.fonts.add(f)
      if (file.endsWith('-ui.woff2')) f.load().catch(() => {})     // 文案用字的那份主动下；兜底那份等真用到生僻字再说
    } catch (e) { /* 老浏览器：就用合成的粗体 */ }
  }
}
""" % '\n'.join(late)
    open(os.path.join(ROOT, 'src/ui/fonts-late.js'), 'w', encoding='utf-8', newline='\n').write(js)
    print('fonts.css / src/ui/fonts-late.js 已更新；文案用字', len([c for c in cps if c > 0x7f]), '个')


if __name__ == '__main__':
    main()

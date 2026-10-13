#!/usr/bin/env python3
"""
배포용 패키지를 dist/ 에 만든다.

    python3 scripts/build.py            # dist/chrome/, dist/firefox/ 와 각각의 zip
    python3 scripts/build.py --icons    # icons/icon.svg 에서 PNG 를 다시 그린 뒤 위와 같음 (inkscape 필요)

manifest.json(Chrome) 이 원본이다. Chrome 패키지는 저장소에서 필요한 파일만 골라 담고,
Firefox 패키지는 거기에 manifest.json 만 바꾼다. Firefox 는 sidePanel 과 service_worker 가 없어서
sidebar_action 과 background.scripts 로 바꾸고, 서명에 필요한 browser_specific_settings 를 넣는다.
두 매니페스트를 저장소에 따로 두지 않는 이유: Chrome 은 sidebar_action 을, Firefox 는 side_panel 을
모르는 키라고 경고하므로 한 파일로 둘 다 조용히 만족시킬 수 없다.
"""
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
# 패키지에 들어가는 것. 스크립트·문서·dist 는 뺀다.
INCLUDE = ['src', 'icons', 'seed.md', 'LICENSE']
ICON_SIZES = [16, 48, 128]

# Firefox 140 부터 data_collection_permissions 를 알고, 128 부터 scripting 의 world: 'MAIN' 을 지원한다.
GECKO = {
    'id': 'chrome-stepper-sidebar@osom8979.github.io',
    'strict_min_version': '140.0',
    'data_collection_permissions': {'required': ['none']},
}


def render_icons():
    svg = ROOT / 'icons' / 'icon.svg'
    for size in ICON_SIZES:
        png = ROOT / 'icons' / f'icon-{size}.png'
        subprocess.run(['inkscape', str(svg), '-w', str(size), '-h', str(size), '-o', str(png)], check=True, stderr=subprocess.DEVNULL)
        print(f'{png.relative_to(ROOT)}')


def firefox_manifest(chrome):
    manifest = {k: v for k, v in chrome.items() if k not in ('minimum_chrome_version', 'side_panel')}
    manifest['permissions'] = [p for p in chrome['permissions'] if p != 'sidePanel']
    manifest['background'] = {'scripts': [chrome['background']['service_worker']], 'type': 'module'}
    manifest['sidebar_action'] = {
        'default_panel': chrome['side_panel']['default_path'],
        'default_title': chrome['action']['default_title'],
        'default_icon': chrome['icons'],
        'open_at_install': True,
    }
    manifest['browser_specific_settings'] = {'gecko': GECKO}
    return manifest


def package(name, manifest):
    out = DIST / name
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    for item in INCLUDE:
        src = ROOT / item
        if src.is_dir():
            shutil.copytree(src, out / item, ignore=shutil.ignore_patterns('*.svg'))
        else:
            shutil.copy2(src, out / item)
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    archive = DIST / f"chrome-stepper-sidebar-{name}-{manifest['version']}.zip"
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(out.rglob('*')):
            if path.is_file():
                zf.write(path, path.relative_to(out))
    return out, archive


def main(argv):
    if '--icons' in argv:
        render_icons()
    chrome = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    out, archive = package('chrome', chrome)
    print(f'{archive.relative_to(ROOT)}  ->  Chrome 웹 스토어 대시보드에 올리기')
    out, archive = package('firefox', firefox_manifest(chrome))
    print(f'{out.relative_to(ROOT)}/  ->  about:debugging 에서 manifest.json 선택')
    print(f'{archive.relative_to(ROOT)}  ->  addons.mozilla.org 서명용')


if __name__ == '__main__':
    main(sys.argv[1:])

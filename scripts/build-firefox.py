#!/usr/bin/env python3
"""
Firefox 용 패키지를 dist/firefox/ 에 만든다. 소스는 그대로 복사하고 manifest.json 만 바꾼다.

    python3 scripts/build-firefox.py

manifest.json(Chrome) 이 원본이다. Firefox 는 sidePanel 과 service_worker 가 없어서
sidebar_action 과 background.scripts 로 바꾸고, 서명에 필요한 browser_specific_settings 를 넣는다.
두 매니페스트를 따로 두지 않는 이유: Chrome 은 sidebar_action 을, Firefox 는 side_panel 을
모르는 키라고 경고하므로 한 파일로 둘 다 조용히 만족시킬 수 없다.
"""
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist' / 'firefox'
COPY = ['src', 'seed.md', 'LICENSE']

# Firefox 140 부터 data_collection_permissions 를 알고, 128 부터 scripting 의 world: 'MAIN' 을 지원한다.
GECKO = {
    'id': 'chrome-stepper-sidebar@osom8979.github.io',
    'strict_min_version': '140.0',
    'data_collection_permissions': {'required': ['none']},
}


def firefox_manifest(chrome):
    manifest = {k: v for k, v in chrome.items() if k not in ('minimum_chrome_version', 'side_panel')}
    manifest['permissions'] = [p for p in chrome['permissions'] if p != 'sidePanel']
    manifest['background'] = {'scripts': [chrome['background']['service_worker']], 'type': 'module'}
    manifest['sidebar_action'] = {
        'default_panel': chrome['side_panel']['default_path'],
        'default_title': chrome['action']['default_title'],
        'open_at_install': True,
    }
    manifest['browser_specific_settings'] = {'gecko': GECKO}
    return manifest


def main():
    chrome = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    for name in COPY:
        src = ROOT / name
        if src.is_dir():
            shutil.copytree(src, OUT / name)
        else:
            shutil.copy2(src, OUT / name)
    manifest = firefox_manifest(chrome)
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    archive = OUT.parent / f"chrome-stepper-sidebar-firefox-{manifest['version']}.zip"
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(OUT.rglob('*')):
            if path.is_file():
                zf.write(path, path.relative_to(OUT))
    print(f'{OUT.relative_to(ROOT)}/  ->  about:debugging 에서 manifest.json 선택')
    print(f'{archive.relative_to(ROOT)}  ->  서명·배포용')


if __name__ == '__main__':
    main()

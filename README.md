# chrome-stepper-sidebar

Stepper sidebar for Chrome extensions

시연용 브라우저 확장입니다. Chrome 과 Firefox 에서 같은 소스로 동작합니다. 브라우저 오른쪽 사이드 패널에 시연 단계가 나열되고, 단계를 누르면 현재 탭이 그 페이지로 이동합니다. 어느 사이트에나 쓸 수 있고, 시나리오는 패널에서 바로 편집하거나 Markdown 파일로 주고받습니다.

## 설치

1. `chrome://extensions` 를 열고 오른쪽 위 **개발자 모드** 를 켭니다.
2. **압축해제된 확장 프로그램 로드** 를 눌러 이 폴더를 고릅니다.
3. 툴바의 퍼즐 아이콘에서 Chrome Stepper Sidebar 를 고정한 뒤 누르면 사이드 패널이 열립니다.

**Firefox**

Firefox 는 Chrome 의 `sidePanel` 과 service worker 백그라운드가 없어서 매니페스트가 다릅니다. 소스는 같고 `manifest.json` 만 바꾼 패키지를 스크립트로 만듭니다.

```sh
python3 scripts/build.py
```

1. `about:debugging#/runtime/this-firefox` 를 열고 **임시 부가 기능 로드** 를 누릅니다.
2. `dist/firefox/manifest.json` 을 고릅니다. 사이드바가 바로 열립니다. 닫았으면 툴바 버튼이나 `Ctrl+B` 사이드바 메뉴에서 다시 엽니다.
3. `dist/chrome-stepper-sidebar-firefox-<버전>.zip` 은 [addons.mozilla.org](https://addons.mozilla.org/developers/) 에서 서명해 영구 설치할 때 씁니다. Firefox 140 이상이 필요합니다.

Firefox 에서는 사이트 접근 권한을 설치 때 묻습니다. 거부했거나 임시 로드에서 빠졌으면 **spa** 이동이 조용히 **reload** 로 대신되니, `about:addons` 의 이 확장 → **권한** 탭에서 "모든 웹사이트의 데이터 접근" 을 켭니다. 단축키는 `about:addons` 오른쪽 위 톱니 → **확장 단축키 관리** 에서 바꿉니다.

처음 설치할 때 `seed.md` 의 예시 시나리오가 한 번 들어갑니다.

## 스토어 배포

```sh
python3 scripts/build.py
```

`dist/` 에 두 브라우저의 zip 이 생깁니다. 저장소에서 `manifest.json`, `icons/*.png`, `seed.md`, `src/` 만 담고 문서와 스크립트는 뺍니다.

**Chrome 웹 스토어**

1. [개발자 대시보드](https://chrome.google.com/webstore/devconsole) 에 로그인하고 일회성 등록비(5달러)를 냅니다. 계정 이메일은 나중에 바꿀 수 없습니다.
2. **새 항목** 에 `dist/chrome-stepper-sidebar-chrome-<버전>.zip` 을 올립니다.
3. **스토어 등록정보**: 설명, 카테고리, 아이콘(`icons/icon-128.png`), 스크린샷(1280x800 또는 640x400, 한 장 이상)을 채웁니다. 스크린샷은 저장소에 없으니 패널을 연 화면을 직접 찍습니다.
4. **개인정보 보호 관행**: 단일 목적("시연 단계 순서대로 현재 탭을 이동")을 적고 권한마다 이유를 씁니다.

   | 권한 | 이유 |
   |---|---|
   | `tabs` | 현재 탭 URL 로 지금 단계를 판정 |
   | `storage` | 시나리오와 진행 위치 저장 |
   | `scripting` | spa 이동 때 페이지에 `history.pushState` 를 실행 |
   | 호스트 권한 | 어느 사이트든 시연 대상이 될 수 있음 |

   데이터를 외부로 보내지 않습니다. 원격 코드도 없습니다.
5. **배포**: 시연용이면 **비공개**(지정한 테스터만) 나 **미등록**(링크를 아는 사람만) 을 고릅니다.

새 개발자, 새 확장, 모든 http/https 호스트 권한은 심사를 길게 만듭니다. 대상 사이트가 정해져 있으면 `host_permissions` 를 그 주소로 좁히는 편이 빠릅니다.

**Firefox (addons.mozilla.org)**

[개발자 허브](https://addons.mozilla.org/developers/) 에 `dist/chrome-stepper-sidebar-firefox-<버전>.zip` 을 올립니다. 등록비는 없습니다. 스토어에 싣지 않고 직접 배포할 때도 서명은 받아야 하며, "직접 배포" 를 고르면 서명된 `.xpi` 를 내려받습니다. 매니페스트의 `browser_specific_settings.gecko.id` 가 그 ID 로 고정됩니다.

버전을 올릴 때는 `manifest.json` 의 `version` 만 고치면 두 패키지 이름과 Firefox 매니페스트에 같이 반영됩니다.

## 쓰는 법

**진행 화면**

| 동작 | 방법 |
|---|---|
| 시나리오 바꾸기 | 머리의 선택 상자 |
| 특정 단계로 이동 | 단계 클릭 |
| 다음 / 이전 | 아래 버튼, 또는 전역 단축키 `Alt+Shift+→` / `Alt+Shift+←` |
| 리모컨으로 넘기기 | 패널을 한 번 클릭해 포커스를 둔 뒤 PageDown / PageUp (화살표도 됨) |

현재 단계는 탭 URL 로 판정합니다. 시연 중에 앱 안에서 직접 메뉴를 눌러 이동해도 Stepper 가 따라오고, 시나리오에 없는 화면이면 마지막 단계를 점선으로 표시합니다.

전역 단축키는 `chrome://extensions/shortcuts` 에서 바꿀 수 있습니다. Chrome 확장 단축키에는 Ctrl 이나 Alt 가 반드시 붙어야 해서, 리모컨의 맨 PageDown 은 패널에 포커스가 있을 때만 받습니다.

**편집 화면** (머리의 ✎)

- **+ 현재 페이지**: 지금 탭의 주소와 제목으로 단계를 만듭니다. 기본 URL 과 같은 사이트면 경로만 저장합니다. 시연 순서대로 앱을 돌아다니며 이 버튼만 눌러도 시나리오가 만들어집니다.
- **+ 빈 단계 / + 구분**: 펼쳐 둔 항목 바로 뒤에, 없으면 끝에 넣습니다.
- 항목을 누르면 펼쳐져서 제목, URL(**현재 URL** 로 덮어쓰기), 판정 방식, 이동 방식, 발표 메모를 고칠 수 있습니다. **열어 보기** 는 진행 위치와 상관없이 그 주소를 엽니다.
- 순서는 ⠿ 를 끌거나 ↑ ↓ 로 바꿉니다.
- **Markdown** 탭에서 원문을 바로 고칠 수 있습니다. 형식은 파일과 같습니다.
- 사본을 고치다가 **저장** 할 때만 반영합니다. URL 이 비었거나 정규식이 틀리면 저장이 막히고 문제 목록이 뜹니다. 고친 내용이 있으면 **취소** 를 두 번 눌러야 버립니다.

**관리 메뉴** (머리의 ⋯)

새 시나리오, 복제, Markdown 가져오기, 이 시나리오 내보내기, 전체 내보내기, 예시 다시 넣기, 삭제(두 번 클릭).

## Markdown 형식

```markdown
# 시나리오 제목

- 기본 URL: http://localhost:5173
- 이동 방식: spa

## 구분 제목

### 단계 제목

- URL: /datasets/ds-xxxx
- 판정: regex `^/datasets/ds-[^/]+$`
- 이동: reload

발표 메모. 다음 제목 전까지 전부 메모입니다.
여러 줄도 그대로 보입니다.
```

| 위치 | 키 | 값 |
|---|---|---|
| `#` 아래 | `기본 URL` | 경로만 쓴 단계의 기준 주소. 비워 두면 단계마다 전체 주소를 씁니다 |
| `#` 아래 | `이동 방식` | `spa` (기본), `reload`, `newtab` |
| `###` 아래 | `URL` | 경로(`/datasets`)나 전체 주소(`https://grafana.example/d/1`). 사이트를 섞어도 됩니다 |
| `###` 아래 | `판정` | `exact` (기본), `prefix [경로]`, `regex 패턴` |
| `###` 아래 | `이동` | `inherit` (기본, 시나리오 값을 따름), `spa`, `reload`, `newtab` |

규칙
- `#` 가 여럿이면 한 파일에 시나리오가 여럿입니다. `#` 없이 `###` 부터 쓰면 파일 이름을 제목으로 한 시나리오 하나로 읽습니다.
- 제목 바로 아래의 `- 키: 값` 목록만 속성입니다. 빈 줄이 나오면 속성이 끝나고, `###` 아래의 나머지 본문은 발표 메모가 됩니다. `#` 와 `##` 아래 본문은 버립니다.
- 키와 값은 한국어 이름도 받습니다. 예: `주소`, `경로`, `새로고침`, `새 탭`, `경로 접두사`, `정규식`.
- 정규식은 백틱으로 감싸 두면 Markdown 뷰어에서 `[` `*` `_` 가 깨지지 않습니다. 내보낼 때는 늘 감쌉니다.
- 메모 줄이 `#` 로 시작하면 `\#` 로 적습니다.
- 알 수 없는 값은 가져올 때 기본값으로 바꾸고 몇째 줄인지 알려 줍니다. 편집 화면의 Markdown 탭에서는 반영을 막습니다.

## 현재 단계 판정

| 판정 | 걸리는 URL | 쓰임 |
|---|---|---|
| `exact` | 경로가 같음. 끝의 `/` 는 무시. 단계 URL 에 쿼리나 해시가 있을 때만 그것까지 비교 | 대부분의 화면 |
| `prefix` | 경로가 그 접두사 아래. 접두사를 비우면 단계 URL 의 경로 | 목록에서 상세로 들어가도 같은 단계로 볼 때 |
| `regex` | `pathname + search + hash` 가 정규식에 맞음 | 상세 화면처럼 ID 가 들어가는 경로 |

- 사이트(스킴과 호스트)가 다르면 걸리지 않습니다.
- 한 URL 에 여러 단계가 걸리면 `exact` 가 `regex` 를, `regex` 가 `prefix` 를 이깁니다.
- 같은 수준에서 여럿이 걸리면 지금 단계를 유지하고, 아니면 그 뒤쪽의 첫 단계를 고릅니다. 그래서 한 화면에서 말할 거리를 단계 여럿으로 나눠도 됩니다.

## 이동 방식

- **spa**: 탭이 이미 같은 사이트면 페이지 안에서 `history.pushState` 를 한 뒤 `popstate` 를 일으켜, React Router 가 새로고침 없이 이동하게 합니다. 상태 객체 `{ usr, key, idx }` 는 React Router 내부 형식을 흉내 낸 것이라 라이브러리 메이저 버전이 바뀌면 깨질 수 있습니다. 실패하면 자동으로 reload 로 대신합니다.
- **reload**: 탭 주소를 바꿔 새로 불러옵니다. 가장 확실하지만 이동마다 화면이 한 번 깜빡입니다. React Router 가 아닌 앱이면 이쪽을 씁니다.
- **newtab**: 현재 탭 오른쪽에 새 탭을 엽니다. 대시보드나 문서처럼 다른 사이트를 잠깐 보여 줄 때 씁니다.

## 구조

```
chrome-stepper-sidebar/
  manifest.json            MV3 선언 (권한, 사이드 패널, 전역 단축키). Chrome 용이자 원본
  seed.md                  처음 설치할 때 넣는 예시 시나리오
  icons/
    icon.svg               아이콘 원본. PNG 는 scripts/build.py --icons 로 다시 그린다 (inkscape)
    icon-{16,48,128}.png   매니페스트와 스토어가 쓰는 아이콘
  scripts/
    build.py               dist/ 에 Chrome·Firefox 패키지와 zip 을 만든다
  src/
    background.js          컨트롤러: 단계 이동, 단축키, 탭 URL 추적
    shared/
      api.js               browser.* (Firefox) 또는 chrome.* (Chrome) 고르기
      scenario.js          시나리오 모델: 정규화, URL 풀기, 현재 단계 판정, 검증 (chrome API 없음)
      markdown.js          시나리오 ⇄ Markdown
      store.js             저장소: local(시나리오 목록) / session(진행 위치)
      navigate.js          탭 이동 (spa / reload / newtab)
    panel/
      panel.html, .css
      panel.js             머리(시나리오 선택, 관리 메뉴)와 화면 전환
      play-view.js         진행 화면
      edit-view.js         편집 화면 (폼 / Markdown 탭)
      dom.js, io.js        DOM 도우미, 파일 내려받기·고르기
```

흐름은 한 방향입니다.

```
패널 클릭·단축키 → background → 탭 이동
                                  ↓ tabs.onUpdated
패널 다시 그림 ← storage.session ← URL 로 현재 단계 판정
```

시나리오는 `storage.local` 에 있습니다. 확장은 자기 폴더에 쓸 수 없으므로 `seed.md` 를 고쳐도 이미 설치된 시나리오는 바뀌지 않습니다. 파일로 남기거나 옮기려면 내보내기와 가져오기를 씁니다.

## 고친 뒤 반영

| 고친 것 | 반영 방법 |
|---|---|
| 시나리오 | 편집 화면에서 저장하면 바로 반영 |
| `seed.md` | 관리 메뉴의 **예시 다시 넣기** (새 시나리오로 추가됨) |
| `src/panel/*` | 패널을 닫았다 다시 열기 |
| `manifest.json`, `src/background.js`, `src/shared/*` | `chrome://extensions` 에서 이 확장의 새로고침 |
| Firefox 에서 무엇이든 | `python3 scripts/build.py` 를 다시 돌리고 `about:debugging` 에서 **다시 로드** |

브라우저마다 다른 곳은 두 군데뿐입니다. `src/shared/api.js` 가 API 네임스페이스를 고르고, `src/background.js` 첫머리가 패널 여는 방법(`sidePanel` / `sidebarAction`)을 고릅니다. 나머지 API(`tabs`, `storage.session`, `scripting` 의 `world: "MAIN"`, `commands`)는 두 브라우저가 같습니다.

확장을 새로고침해도 시나리오는 남습니다. 확장을 **삭제** 하면 시나리오도 사라지니, 필요하면 먼저 **전체 내보내기** 를 해 둡니다.

## 시연 전 확인

- **화면 공유 범위**: 탭만 공유하면 사이드 패널은 청중에게 보이지 않고, 창이나 전체 화면을 공유하면 보입니다.
- **앱 폭**: 패널 폭만큼 앱 화면이 좁아집니다. 패널 가장자리를 끌어 폭을 맞추고, 시연 해상도에서 반응형 레이아웃이 깨지지 않는지 봅니다.
- **편집 중 패널 닫기**: 저장하지 않은 편집은 패널을 닫으면 사라집니다.
- **권한 범위**: `host_permissions` 가 모든 http/https 라서 시연용 브라우저 프로필에만 설치하는 편이 좋습니다. 대상이 정해져 있으면 `"http://localhost:5173/*"` 처럼 좁혀도 됩니다.
- **로그인**: 같은 탭을 이동시키므로 세션은 그대로 유지됩니다. 시작 전에 로그인만 해 두면 됩니다.

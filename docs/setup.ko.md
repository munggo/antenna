# 설정 안내

[English](./setup.md) · [README](../README.ko.md) 로 돌아가기

보통은 `sh install.sh` 하나면 된다. 이 글은 그 명령이 무엇을 해 두는지, 어떻게 바꾸는지, 그리고 선택해서 쓰는 것들을 설명한다.

- [설정 값](#설정-값)
- [밖에서 맥에 붙기](#밖에서-맥에-붙기)
- [앱 빌드](#앱-빌드)
- [알림](#알림)
- [사용량](#사용량)
- [단축어](#단축어)
- [선택 기능](#선택-기능)
- [새 판으로 올리기](#새-판으로-올리기)
- [문제 해결](#문제-해결)
- [빼기](#빼기)

## 설정 값

모든 설정은 파일 하나 `~/.config/pi-remote/env`(권한 600)에 있고, 브리지가 켜질 때 읽는다.

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `PI_TMUX_SESSION` | `antenna` | 브리지가 붙을 tmux 세션. 없으면 브리지가 만든다 |
| `HOST` | `0.0.0.0` | 브리지가 듣는 주소 |
| `PORT` | `8787` | 브리지가 듣는 포트 |
| `PI_REMOTE_TLS_ONLY` | `1` | 암호화 연결만 받는다. 암호화 없이 붙는 예전 앱을 아직 쓸 때만 이 줄을 지운다 |
| `PI_REMOTE_NODE` | `install.sh` 가 찾음 | 브리지를 돌릴 node. 자동 실행에서는 셸의 `PATH` 가 없어 경로를 적어 둔다 |
| `PI_REMOTE_HOSTS` | 없음 | 폰이 같은 Wi-Fi 밖에서 쓸 맥의 IP 주소. 쉼표로 여러 개, 빈칸 없이. 짝짓기 QR 에 들어간다 |

파일을 고친 뒤에는 브리지를 다시 시작한다. 포트·주소가 바뀌었으면 폰을 다시 짝짓는다.

```sh
launchctl kickstart -k gui/$(id -u)/com.munggo.pi-remote   # 브리지 다시 시작
sh deploy/pair.sh                                          # 짝짓기 QR 띄우기
```

`sh install.sh --no-agent` 는 로그인 항목에 등록하지 않는다. 그때는 `server/run.sh` 로 브리지를 직접 켠다. 켜기 전에는 설치 끝의 점검이 브리지 항목을 ✗ 로 보여 주는데, 켜면 사라진다.

### 짝지은 기기

폰의 토큰은 설정 파일에 없다. `sh deploy/pair.sh` 는 5분 동안 한 번만 쓸 수 있는 코드가 든 QR 을 띄우고, 폰은 그 코드를 내고 자기만의 토큰을 받는다. 맥에는 그 토큰의 해시만 `~/.config/pi-remote/devices.json` 에 남는다.

QR 에는 맥 인증서의 지문도 들어 있다. 브리지는 처음 뜰 때 그 인증서를 만들고(`~/.config/pi-remote/tls/`), 앱은 그 지문의 맥이 내민 암호화 연결만 받아들인다. 인증서를 지웠으면 폰을 다시 짝짓는다.

```sh
sh deploy/pair.sh                  # 폰 짝짓기
sh deploy/pair.sh --list           # 짝지은 기기
sh deploy/pair.sh --revoke <번호>   # 하나 끊기(열려 있던 연결도 1분 안에 닫힘)
```

앱 메뉴의 '연결 토큰 바꾸기'는 그 폰의 토큰만 바꾼다.

(예전 판에서 올라온 맥에만 해당한다.) 기기별 토큰이 생기기 전에 설치한 맥에는 설정 파일에 공유 토큰 `PI_REMOTE_TOKEN` 줄이 있고 `PI_REMOTE_TLS_ONLY` 줄이 없어서, 그때 짝지은 폰은 암호화 없이 계속 붙는다. 모든 폰이 지금 앱으로 새로 짝지은 뒤에는 `PI_REMOTE_TOKEN` 줄을 지우고 `PI_REMOTE_TLS_ONLY=1` 을 적은 다음 브리지를 다시 시작한다. 그런 폰에서 '연결 토큰 바꾸기'를 눌러도 같은 일이 일어난다: 그 폰은 자기만의 토큰을 받고 공유 토큰은 없어진다. `sh deploy/pair.sh --legacy` 는 짝짓기 코드를 모르는 예전 앱을 위한 예전 방식의 QR 을 띄운다.

## 밖에서 맥에 붙기

같은 Wi-Fi 에서는 폰이 맥을 스스로 찾으므로 할 일이 없다. 밖에서도 쓰려면 폰과 맥이 서로 닿는 사설망(VPN)이 하나 있어야 한다. 공유기에서 브리지 포트를 인터넷에 열어 두는 방식(포트 포워딩)은 쓰지 않는다.

폰은 같은 망에서 찾은 주소(Bonjour)와 짝짓기 QR 로 받은 주소에 한꺼번에 연결을 걸어, 먼저 답하는 쪽을 쓴다. 그래서 집에서든 밖에서든 앱에서 바꿀 것이 없다.

### 망 고르기

| 방식 | 이런 때 | 준비할 것 |
|---|---|---|
| [기기끼리 잇는 VPN 서비스](#기기끼리-잇는-vpn-서비스)(Tailscale 등) | 가장 쉽다. 공유기를 손댈 수 없거나 맥을 들고 다닐 때 | 맥과 폰에 앱을 깔고 같은 계정으로 로그인 |
| [집 공유기의 VPN 서버](#집-공유기의-vpn-서버)(OpenVPN·WireGuard) | 공유기에 VPN 서버 기능이 있고, 다른 서비스에 기대고 싶지 않을 때 | 공유기에서 VPN 서버를 켜고 폰에 접속 설정을 넣는다. 맥을 들고 다니면 맥에도 넣는다 |
| [회사 VPN](#회사-vpn) | 회사 맥을 회사 망 안에서만 써야 할 때 | VPN 관리자의 도움 |

인터넷 주소를 가려 주는 유료 VPN(나라를 골라 접속하는 종류)은 내 기기끼리 이어 주지 않아서 쓸 수 없다.

### 공통 순서

어느 방식이든 하는 일은 같다. 그 망에서 맥이 받은 IP 주소를 Antenna 에 알려 주고 QR 을 다시 찍는다.

1. 먼저 같은 Wi-Fi 에서 짝지어 앱이 되는 것부터 확인한다([빠른 시작](../README.ko.md#빠른-시작)).
2. 폰과 맥을 고른 망에 올린다(아래 방식별 안내).
3. 그 망에서의 맥 IP 주소를 `sh install.sh --host <주소>` 로 알려 준다. 여러 개는 쉼표로 잇는다. IP 주소로 적는다(이름으로는 시험해 보지 않았다).
4. `sh deploy/pair.sh` 로 QR 을 다시 찍는다. 주소는 QR 에 담겨 폰으로 간다.
5. 폰의 Wi-Fi 를 끄고 VPN 을 켠 채 앱을 열어 붙는지 본다.

점검 명령(`node deploy/doctor.mjs`)은 `PI_REMOTE_HOSTS` 의 주소가 지금 맥에 올라와 있지 않으면 알려 준다. 재부팅 뒤에는 브리지가 그 주소를 최대 90초 기다렸다가, 알림이 설정돼 있으면 밖에서 붙을 길이 준비됐는지 폰에 알린다.

연결은 암호화되고, 앱은 내 맥의 인증서만 믿는다. 그래도 포트를 인터넷에 열지는 말고, 사설망으로 맥에 붙는다.

### 기기끼리 잇는 VPN 서비스

Tailscale 을 예로 든다. 비슷한 서비스도 같은 식이다.

1. 맥과 폰에 Tailscale 앱을 깔고 같은 계정으로 로그인한다.
2. 맥의 Tailscale 주소를 본다(메뉴 막대의 Tailscale 아이콘에 있다). `100.` 으로 시작한다.
3. `sh install.sh --host <그 주소>` 를 돌리고 QR 을 다시 찍는다.

앱이 스스로 다시 붙으므로 맥을 들고 다녀도 따로 할 일이 없다. 회사 맥이라면 이런 앱을 깔아도 되는지 먼저 확인한다.

### 집 공유기의 VPN 서버

작성자가 날마다 쓰는 방식이다(공유기의 OpenVPN 서버).

**공유기에서**

1. 관리 화면에서 VPN 서버(OpenVPN 이나 WireGuard)를 켠다. 메뉴 이름과 자리는 공유기마다 다르니 제조사 안내를 따른다.
2. 집의 인터넷 주소는 바뀔 수 있다. 공유기의 DDNS(바뀌는 주소에 붙이는 이름) 기능을 켜고, 접속 설정이 그 이름으로 붙게 한다.
3. 접속 설정(OpenVPN 은 `.ovpn` 파일)은 기기마다 따로 만든다. 폰과 맥이 같은 설정을 함께 쓰면 서로 연결을 끊을 수 있다.
4. VPN 으로 들어온 기기가 집 안의 기기에 닿을 수 있게 한다(대개 '로컬 네트워크 접근' 같은 이름의 설정).

집 인터넷이 밖에서 들어올 수 없는 주소(통신사가 여러 집에 나눠 주는 주소)를 쓰면 이 방식은 되지 않는다. 그때는 위의 VPN 서비스를 쓴다.

**폰에서** OpenVPN Connect(또는 WireGuard) 앱을 깔고 접속 설정을 불러온다.

**맥이 늘 집에 있으면** 맥은 VPN 에 붙일 필요가 없다. 맥의 집 망 주소를 알려 준다.

```sh
ipconfig getifaddr en0             # 맥의 집 망 주소(유선으로 이었으면 en0 가 아닐 수 있다)
sh install.sh --host <그 주소>
```

주소가 바뀌지 않게 공유기에서 맥에 고정 주소를 준다(DHCP 예약).

**맥을 들고 다니면** 맥도 같은 VPN 에 붙여 두고, VPN 망에서 맥이 받은 주소를 알려 준다. 그러면 맥이 어디에 있든 폰은 그 주소 하나로 붙는다.

- 맥의 접속 설정은 집 쪽 주소만 VPN 으로 보내게 한다. 그러지 않으면 맥의 인터넷이 모두 집을 거친다. OpenVPN 은 `route-nopull` 을 넣고 필요한 대역만 `route` 줄로 적는다.
- VPN 서버에서 VPN 에 붙은 기기끼리의 통신을 허용한다(OpenVPN 의 `client-to-client`). 막혀 있으면 폰이 맥에 닿지 못한다.
- 맥의 VPN 주소가 바뀌지 않게 서버에서 그 기기에 고정 주소를 준다. 바뀌면 `--host` 와 QR 을 다시 한다.
- 맥의 VPN 주소는 `ifconfig` 에서 `utun` 으로 시작하는 항목의 `inet` 값이다.
- OpenVPN 이면 [맥을 OpenVPN 서버에 늘 붙여 두기](#맥을-openvpn-서버에-늘-붙여-두기)로 끊겨도 스스로 다시 붙게 한다. WireGuard 앱은 스스로 다시 붙는다.

### 회사 VPN

폰과 맥이 회사 VPN 에서 서로 닿으면 된다. 다만 아래 넷은 VPN 관리자만 해 줄 수 있으므로, 시작하기 전에 관리자에게 부탁한다.

- 폰을 회사 VPN 에 붙여도 되는지, 그리고 폰에 넣을 접속 설정
- 폰에서 맥의 브리지 포트(TCP 8787, 바꿨다면 그 포트)로 가는 길. VPN 에 붙은 기기끼리의 통신은 막아 둔 곳이 많다
- 맥이 그 망에서 늘 같은 주소를 받는지. 주소가 바뀌면 `--host` 와 QR 을 다시 해야 한다
- 회사 맥에 이 도구를 써도 되는지. 폰에서 맥의 터미널에 글자를 칠 수 있게 하는 도구다([보안](../README.ko.md#보안))

길이 열리면 나머지는 [공통 순서](#공통-순서)와 같다. 회사 VPN 이 OpenVPN 이고 맥이 스스로 다시 붙어야 하면 [맥을 OpenVPN 서버에 늘 붙여 두기](#맥을-openvpn-서버에-늘-붙여-두기)를 쓴다.

## 앱 빌드

TestFlight 초대로 앱을 받았으면 이 절은 필요 없다.

Xcode, XcodeGen, 그리고 Apple Developer Program 가입(유료)이 필요하다. 앱이 푸시 알림 권한을 쓰는데, 무료 계정으로는 서명할 수 없다.

- 작성자는 Xcode 27.2 로 빌드한다. 더 옛 판으로는 시험하지 않았다.
- 터미널 화면(SwiftTerm)이 Metal 셰이더를 써서 Xcode 의 Metal 툴체인이 있어야 한다. 없으면 `xcodebuild -downloadComponent MetalToolchain` 으로 받는다.
- 폰에서는 개발자 모드를 켠다(설정 › 개인정보 보호 및 보안 › 개발자 모드. 폰을 Xcode 에 한 번 이은 뒤에 보인다).

```sh
cp ios/Local.xcconfig.example ios/Local.xcconfig
```

`ios/Local.xcconfig` 에 두 값을 채운다. 이 파일은 git 에 올라가지 않는다.

- `DEVELOPMENT_TEAM` — 팀 번호(10글자. developer.apple.com 멤버십 세부사항에 있음)
- `BUNDLE_ID_PREFIX` — 나만 쓰는 앞부분(예: 가진 도메인을 거꾸로 적은 것). 앱 식별자는 `<앞부분>.piremote` 가 된다

**Xcode 로**

```sh
(cd ios && xcodegen generate && open PiRemote.xcodeproj)
```

폰을 맥에 이어 신뢰한 뒤, Xcode 에서 폰을 고르고 실행한다. `project.yml` 이나 xcconfig 파일을 고치면 `xcodegen generate` 를 다시 돌린다.

**명령줄로**(폰이 맥과 같은 Wi-Fi 에 있을 때)

`sh deploy/install-ios.sh` 는 Xcode 계정 대신 App Store Connect API 키로 빌드해 설치한다. 읽는 값:

- `~/.appstoreconnect/config` — `ASC_KEY_ID`, `ASC_ISSUER_ID`. 키 파일은 `~/.appstoreconnect/private_keys/AuthKey_<키 번호>.p8`
- `~/.config/pi-remote/env` — `PI_REMOTE_DEVICE`: `xcrun devicectl list devices` 에 나오는 내 폰의 식별자

`deploy/testflight.sh` 와 `deploy/testflight-setup.mjs` 는 TestFlight 에 올린다(폰이 같은 망에 없어도 받을 수 있음). 작성자의 앱 식별자와 프로필 이름에 맞춰 쓴 것이라, 자신의 계정에서 쓰려면 고쳐서 쓴다.

## 알림

알림은 브리지가 내 키로 Apple 푸시 서버에 바로 보낸다. 그래서 직접 빌드하고 서명한 앱에서만 된다.

1. developer.apple.com 에서 Apple Push Notifications service 를 켠 키를 만들어 `.p8` 파일을 받는다.
2. `~/.config/pi-remote/env` 에 네 줄을 더한다.

   ```sh
   PI_REMOTE_APNS_KEY=~/.config/pi-remote/AuthKey_XXXXXXXXXX.p8
   PI_REMOTE_APNS_KEY_ID=XXXXXXXXXX
   PI_REMOTE_APNS_TEAM=YYYYYYYYYY
   PI_REMOTE_APNS_TOPIC=<앞부분>.piremote
   ```

   `PI_REMOTE_APNS_TOPIC` 은 앱 식별자(번들 ID)다.
3. 브리지를 다시 시작하고, 앱에서 알림을 허용한다.

에이전트가 질문하거나 승인을 기다릴 때, 그리고 앱에서 정한 시간(기본 1시간)보다 오래 걸린 작업이 끝났을 때 알림이 온다. 맥을 쓰는 중에는 알림을 미룬다: 답을 기다리는 질문은 맥이 잠기거나 한동안 쓰지 않으면 그때 보내고, 작업이 끝났다는 알림은 보내지 않는다.

맥에 권한 창('…이(가) …에 접근하려고 합니다')이 떠 있을 때도 알림이 온다. 어느 탭이 무슨 권한을 기다리는지 알면 함께 적는다. macOS 는 이 창을 프로그램이 누르지 못하게 막아 둬서 폰에서는 허용할 수 없다. 맥에서 눌러야 그 탭의 작업이 이어진다. 이 알림도 맥을 쓰는 중이면 미뤘다가, 창이 남은 채로 맥을 쓰지 않게 되면 보낸다. 이런 창을 줄이려면 시스템 설정 > 개인정보 보호 및 보안 > 전체 디스크 접근 권한에 `~/Library/Application Support/Antenna/Antenna 연결부` 를 넣는다. 브리지는 쓰는 node 를 이 이름으로 복사해 돌므로 권한 창과 목록에 'node' 대신 이 이름이 보인다. 브리지가 띄운 tmux 의 탭은 모두 이 이름으로 권한을 받으므로 한 번이면 된다(이 기능 전에 띄운 tmux 의 탭은 재부팅 전까지 node 이름을 쓴다). 다른 앱 제어나 사진처럼 미리 넣을 수 없는 권한은 처음 한 번은 창에서 허용해야 한다.

## 사용량

사용량 화면은 Claude 구독 한도를 보여 준다. 브리지는 pi 의 로그인(`~/.pi/agent/auth.json`)으로 값을 읽는다. 그 로그인의 만료가 가까우면 pi 가 쓰는 방식 그대로 스스로 갱신하므로, pi 를 한동안 쓰지 않아도 조회가 이어진다. 모델별 한도(예: Fable)는 이 조회로만 알 수 있고, 있으면 서랍의 고리가 두 겹으로 보인다. pi 의 로그인이 없으면 `~/.cache/pi-remote/claude-accounts.json` 에 적힌 값을 쓰는데, 이 파일은 pi 확장 `claude-accounts` 가 적는다.

계정을 둘 쓰고(아래 'Claude 계정 둘') 둘째 계정의 토큰이 `claude setup-token` 으로 만든 것이면, 그 토큰은 사용량을 조회할 수 없다. 둘째 계정의 한도까지 보려면 조회 전용 로그인을 한 번 받아 둔다: `node deploy/usage-login.mjs work`(찍히는 주소를 열어 둘째 계정으로 승인하고 코드를 붙여넣는다. `~/.config/pi-remote/usage-auth.json` 에 본인만 읽게 저장된다. `status`·`logout` 도 있다).

Claude Code 만 쓰면 아직 그 값을 적어 주는 것이 없어서, 화면에 값이 없다고 나온다. 이를 위한 작은 상태 줄 도우미는 아직 이 저장소에 들어 있지 않다.

## 단축어

앱을 깔면 단축어 앱에 동작이 하나 생긴다: **맥의 AI 에게 일 시키기**. 맥에서 새 백그라운드 탭을 열어 Claude Code 나 pi 를 할 일과 함께 켠다. 앱 화면을 열지 않고 뒤에서 돌기 때문에 단축어 자동화에 걸어 둘 수 있다.

| 칸 | 뜻 |
|---|---|
| 할 일 | 에이전트에게 시킬 글 |
| 누구에게 | Claude Code(기본) 또는 pi. 고른 도구가 맥에 깔려 있어야 한다 |
| 폴더 | 맥에서 시작할 폴더(예: `~/works/my-project`). 비우면 홈 폴더 |

쓰는 법: 단축어 앱에서 새 단축어를 만들고, 동작 추가에서 Antenna 의 '맥의 AI 에게 일 시키기'를 고른다. 폰의 사건에 걸려면 단축어 앱의 자동화 탭에서 조건(시간, 도착, 충전기 연결, NFC 태그 등)을 고르고 이 동작을 넣는다. Siri 에게 "Antenna에 일 시키기"라고 말하거나 Spotlight 에서 찾아 실행할 수도 있다.

시작한 일은 앱 서랍의 '백그라운드' 칸에 '단축어로 시킴'으로 보인다. [알림](#알림)을 설정했으면 끝났을 때 걸린 시간과 상관없이 알림이 온다. 알림이 오지 않는 앱(TestFlight 로 받은 앱)에서는 그 칸에서 끝났는지 본다.

알아 둘 것:

- 그 순간 폰이 맥에 닿아야 한다(같은 Wi-Fi 이거나 [밖에서 맥에 붙기](#밖에서-맥에-붙기)의 VPN 이 켜져 있음). 닿지 못하면 단축어가 그 까닭을 보여 준다.
- 단축어는 맥을 새로 찾지 않고, 앱이 마지막으로 붙었던 주소와 QR 로 받은 주소로 붙는다. 집 Wi-Fi 에서 맥의 주소가 바뀌었으면 앱을 한 번 열어 다시 붙인다.
- 자동화에 걸 때는 묻지 않고 바로 돌게 고른다('즉시 실행'). 그러지 않으면 조건이 맞을 때마다 폰에서 확인을 눌러야 한다.
- 폰을 껐다 켠 뒤에는 잠금을 한 번 풀어야 한다(연결 토큰을 읽을 수 있게).
- 에이전트는 그 폴더에서 평소 켜는 것과 같은 설정으로 켜진다. 승인을 물으면 평소처럼 폰에 카드와 알림이 온다.
- Claude Code 를 처음 켜는 폴더면 '이 폴더를 믿나요(Yes, I trust this folder)' 창이 뜨는데, Antenna 가 '예'를 대신 누른다. 앱에서 연 새 탭도 같다. 고른 폴더를 믿는 것으로 보기 때문이다.
- 맥의 Antenna 가 이 동작을 모르는 예전 판이면 단축어가 그렇게 알려 준다. 맥을 [새 판으로 올린다](#새-판으로-올리기).

## 선택 기능

여기 있는 것은 `install.sh` 가 깔지 않는다.

### 자동 실행

```sh
sh deploy/install-agents.sh <이름> [<이름> …]   # 이름을 준 것만
sh deploy/install-agents.sh --all               # 전부
```

| 이름 | 하는 일 |
|---|---|
| `claude-auto-update` | 매일 05:00 에 Claude Code 를 업데이트하고, 옛 버전으로 쉬고 있는 세션을 같은 대화로 다시 켠다 |
| `claude-reload` | 30분마다, Claude Code 가 스스로 업데이트한 뒤 옛 버전으로 남은 세션을 같은 식으로 다시 켠다. 30분 넘게 쉬고, 입력창이 비어 있고, 뒤에서 도는 작업이 없는 세션만 건드린다 |
| `pi-auto-update` | 매일 05:00 에 pi 와 확장을 업데이트한다 |
| `antenna-attach` | 로그인하면 iTerm2 를 열어 tmux 세션에 붙는다 |

작성자의 맥에 맞춰 쓴 것이라 전제가 있다. 맞지 않는 맥에서는 등록해도 하는 일이 없다.

- `claude-auto-update`, `claude-reload` — Claude Code 가 `~/.local/bin/claude` 에 있어야 한다(Anthropic 의 설치 스크립트로 깐 자리). Homebrew 나 npm 으로 깐 것은 찾지 못한다
- `pi-auto-update` — nvm 으로 깐 Node 아래의 pi 만 찾는다
- `antenna-attach` — iTerm2 와 Homebrew 로 깐 tmux 가 있어야 한다

빼기: `launchctl bootout gui/$(id -u)/com.munggo.<이름>` 을 한 뒤 `~/Library/LaunchAgents/com.munggo.<이름>.plist` 를 지운다.

### Claude 계정 둘

Claude 구독이 둘이면(예: 개인과 회사) 폴더에 따라 하나를 고르고, 그 계정이 한도에 가까우면 다른 계정으로 바꿔 쓸 수 있다.

- 둘째 계정을 기본으로 쓸 폴더를 `~/.config/pi-remote/work-dirs` 에 한 줄에 하나씩 적는다. `~` 를 쓸 수 있고 `#` 뒤는 주석이다. 이 파일이 없으면 어디서나 첫째 계정을 쓴다.
- 둘째 계정의 토큰은 macOS 키체인 항목 `pi-anthropic-work` 에서 읽는다. 그 계정으로 로그인한 채 `claude setup-token` 으로 토큰을 만든 뒤:

  ```sh
  security add-generic-password -s pi-anthropic-work -a "$USER" -T /usr/bin/security -w
  ```

- Claude Code: `~/.claude/pi-remote/claude-account <폴더>` 가 그 폴더에서 쓸 계정(`work` 나 `personal`)을 내고, `~/.claude/pi-remote/claude-as.sh <계정>` 이 그 계정으로 Claude Code 를 켠다(`work` 면 키체인의 토큰을 `CLAUDE_CODE_OAUTH_TOKEN` 으로 넘긴다). 켤 때마다 맞는 계정이 되게 셸 설정(`~/.zshrc`)에 함수를 둔다.

  ```sh
  claude() {
    ~/.claude/pi-remote/claude-as.sh "$(~/.claude/pi-remote/claude-account "$PWD")" "$@"
  }
  ```

  한도 때문에 계정을 바꿀 때는 같은 대화를 다른 계정으로 이어 켜지 않는다(이어 켜면 문제가 생긴다). 연결부가 이 순서로 바꾼다.
  1. 기본 계정이 95%를 넘으면 일하는 중이어도 Esc 로 멈춘다(남은 사용량으로 인수인계 문서를 써야 하므로). 5시간·주간 한도와 그 탭이 쓰는 모델의 전용 한도(예: Fable 한도)를 모두 본다. 기본 계정으로 돌아올 때는 쉴 때까지 기다린다. 어느 쪽이든 확인 창·질문·돌고 있는 명령·뒤에서 도는 작업·입력창의 글이 있으면 기다린다.
  2. 지금 세션에게 인수인계 문서를 답으로 받아 `<작업 폴더>/.work/handoff/<시각>.md` 에 저장한다(git 에 잡히지 않게 그 폴더에 `.gitignore`). 지금 계정이 이미 한도에 걸려 답 대신 한도 오류나 '어떻게 할까요(What do you want to do?)' 창이 뜨면 기다리지 않고 그 창을 닫은 뒤 문서 없이 넘어간다. 10분 안에 못 받아도 문서 없이 넘어간다.
  3. `/clear` → `/exit` → `claude-as.sh` 로 새 대화를 켠다.
  4. 새 세션에 인수인계 문서(못 받았으면 앞 대화 기록 파일)를 읽고 이어 가라는 글을 넣는다.

  바꾸는 동안 폰에서 보낸 글은 넣지 않고 안내만 한다. 셸 함수를 고치기 전에 열어 둔 셸에서도 맞는 계정으로 켜진다. 다시 켠 뒤에도 계정이 그대로면 6시간 동안 다시 바꾸지 않고 폰에 알린다.

  앱에서 탭마다 고를 수도 있다. Claude Code 탭 입력창의 계정 칩(지금 계정이 보임)을 눌러 자동·개인·회사 가운데 고른다. 고르면 위와 같은 순서로 그 계정으로 새로 켜는데, 일하는 중이면 하던 일이 끝난 뒤에 바꾼다(그동안 칩에 '개인→회사'처럼 보인다). 고른 계정은 그 탭의 기본 계정이 되어, 한도가 95%를 넘으면 다른 계정으로 넘어갔다가(폰에 알림) 풀리면 돌아온다. '자동'을 고르면 다시 폴더·한도로 고른다. 고른 값은 그 탭(tmux 창)에 남고, 맥을 다시 켜 되살린 탭은 자동으로 시작한다.
- pi: 확장을 깐다. `sh pi-extension/install.sh --with claude-accounts`
- 한도에 따라 바꾸려면 계정별 사용량이 있어야 하는데, 지금은 pi 확장 `claude-accounts` 만 그 값을 적는다(`~/.cache/pi-remote/claude-accounts.json`). Claude Code 만 쓰는 맥에서는 폴더에 따라 고르는 것까지만 된다. 둘째 계정에 조회 전용 로그인을 받아 두면(위 '사용량') 브리지가 둘째 계정의 값은 이 파일에 적는다.

### 맥을 OpenVPN 서버에 늘 붙여 두기

사설망이 OpenVPN 서버이고 맥이 스스로 다시 붙어야 할 때만 필요하다. Tailscale 과 WireGuard 앱은 스스로 다시 붙는다.

```sh
brew install openvpn
```

`~/.config/pi-remote/env` 에 더한다.

```sh
PI_REMOTE_VPN_CONFIG=~/.config/pi-remote/client.ovpn   # 내 클라이언트 설정 파일
PI_REMOTE_VPN_GATEWAY=10.8.0.1                         # 선택: 터널 건너편 주소. 30초마다 핑으로 확인
```

그다음:

```sh
sh deploy/install-vpn-guard.sh --print   # 설치될 스크립트를 미리 보기
sudo sh deploy/install-vpn-guard.sh      # root 로 도는 자동 실행으로 설치
```

지킴이는 내 설정 파일로 OpenVPN 을 root 권한으로 띄운다. 그 파일은 나만 고칠 수 있게 둔다(다른 사용자가 고칠 수 있는 파일이면 설치하지 않는다). 빼기: `sudo launchctl bootout system/com.munggo.pi-remote-vpn-guard` 를 한 뒤 `/usr/local/bin/pi-remote-vpn-guard.sh` 와 `/Library/LaunchDaemons/com.munggo.pi-remote-vpn-guard.plist` 를 지운다.

### 그 밖의 pi 확장

```sh
sh pi-extension/install.sh --list
sh pi-extension/install.sh --with compact-tools,web,subagent
```

- `compact-tools` — pi 의 터미널 화면에서 도구 실행을 한 줄씩으로 접는다
- `web` — 웹 검색·가져오기 도구
- `subagent` — 역할이 있는 하위 에이전트와 `/review`·`/security-review` 명령

이미 있던 파일과 내용이 다르면 `~/.cache/pi-remote/backup/` 에 남기고 덮어쓴다. 깐 뒤 pi 에서 `/reload` 한다.

## 새 판으로 올리기

맥과 폰을 따로 올린다. 한쪽만 새 판이어도 쓰던 기능은 그대로 되고, 새로 생긴 기능은 양쪽이 모두 새 판이어야 된다.

맥:

```sh
cd antenna        # 저장소를 받아 둔 폴더
git pull
sh install.sh
```

`install.sh` 는 다시 돌려도 된다. 설정은 그대로 두고, Claude Code 연결부와 pi 확장을 새 판으로 바꾸고, 브리지 코드가 바뀌었으면 브리지를 다시 시작한다(폰 연결이 잠깐 끊겼다 다시 붙는다). 켜져 있던 Claude Code 탭의 연결부는 그 탭이 쉴 때 스스로 새 판으로 바뀐다. 켜져 있던 pi 는 `/reload` 해야 새 확장을 읽는다.

폰: TestFlight 로 받았으면 TestFlight 앱에서 새 판을 받는다(자동 업데이트를 켜 두면 저절로 받는다). 직접 빌드했으면 다시 빌드해 넣는다.

올린 뒤 `node deploy/doctor.mjs` 를 돌려 확인한다.

## 문제 해결

점검 명령부터 돌린다. 설정을 읽고 브리지·훅·설치본을 확인해, 무엇을 하면 되는지 알려 준다.

```sh
node deploy/doctor.mjs
node deploy/doctor.mjs --fix
```

- **QR 을 찍었는데 '맥에 닿지 못했어요'가 나온다.** 폰과 맥이 같은 Wi-Fi 에 있는지 본다. 앱을 처음 연 것이면 로컬 네트워크 접근을 허용한 뒤, QR 이 떠 있는 동안 다시 찍는다(닿지 못한 코드는 쓰이지 않았으니 그대로 쓸 수 있다). 'QR 이 만료됐어요'나 '이미 쓴 QR 이에요'가 나오면 `sh deploy/pair.sh` 를 다시 돌린다.
- **같은 Wi-Fi 인데 앱이 붙지 않는다.** iOS 설정에서 앱의 로컬 네트워크 접근을 허용한다. 브리지가 돌고 포트가 열려 있는지 본다(점검 명령이 둘 다 보여 준다).
- **잘 되다가 한참 뒤에 붙지 않는다.** 맥이 잠들면 브리지도 멈춘다. 폰으로 쓸 동안은 맥이 깨어 있어야 한다. 전원을 꽂아 두고 잠자기를 막는다(터미널에 `caffeinate -s` 를 켜 두거나, 시스템 설정에서 전원을 꽂았을 때 잠자지 않게 바꾼다). 맥북은 덮개를 닫으면 잠든다.
- **집에서는 되는데 밖에서 안 된다.** 차례로 본다. 폰의 VPN 이 켜져 있는지, 맥이 그 망에 올라와 있는지(`PI_REMOTE_HOSTS` 의 주소가 맥에 없으면 점검 명령이 알려 준다), 주소를 바꾼 뒤 QR 을 다시 찍었는지, 그 망이 기기끼리의 통신을 막고 있지 않은지([밖에서 맥에 붙기](#밖에서-맥에-붙기)).
- **Claude Code 탭이 터미널로만 보인다.** 훅이 없거나, 훅을 걸기 전에 켠 세션이다. `sh claude-remote/install.sh` 를 돌리고 Claude Code 세션을 새로 켠다.
- **pi 탭이 터미널로만 보인다.** `sh pi-extension/install.sh` 를 돌리고 pi 에서 `/reload` 한다.
- **잘 되다가 앱이 '연결 중'에서 넘어가지 않는다(맥도 망도 멀쩡한데).** 맥 용량 정리 등으로 브리지의 모듈 폴더 `server/node_modules` 가 지워졌을 수 있다. 브리지는 이미 올려 둔 모듈로 계속 돌지만, 폰이 붙을 때마다 tmux 를 띄우지 못한다(`/tmp/pi-remote.err` 에 'tmux 실행 실패'). 브리지가 1분 안에 알아채 잠금 파일대로 다시 설치하고 그 뒤 접속부터 된다(네트워크 필요, 브리지를 다시 시작하지 않아도 됨). 바로 고치려면 `node deploy/doctor.mjs --fix`. 용량 정리 도구를 쓸 때는 이 폴더를 빼 둔다(다시 만들 수 있는 폴더처럼 보이지만 브리지가 쓰는 중이다).
- **브리지가 자꾸 다시 뜬다.** `/tmp/pi-remote.err` 와 `~/.cache/pi-remote/crash.log` 를 본다.
- **QR 이 찍히지 않는다.** 코드가 줄바꿈되지 않게 터미널 창을 키우고, 화면 밝기를 올린다.

## 빼기

```sh
launchctl bootout gui/$(id -u)/com.munggo.pi-remote
rm ~/Library/LaunchAgents/com.munggo.pi-remote.plist
rm -r ~/.config/pi-remote ~/.cache/pi-remote
```

`~/.cache/pi-remote/backup/` 에는 설치하면서 덮어쓴 내 원래 파일(pi 확장)이 들어 있다. 되살릴 것이 있으면 지우기 전에 꺼낸다.

Claude Code 를 이은 맥에서는 더 한다. 켜져 있는 Claude Code 를 먼저 끈다(탭마다 떠 있는 연결부가 함께 끝난다).

```sh
sh claude-remote/install.sh --remove      # ~/.claude/settings.json 에서 훅을 빼고 /bgtab 명령 파일을 지움
rm -r ~/.claude/pi-remote                 # Claude Code 연결부 파일
```

고치기 전의 설정은 `~/.claude/settings.json.bak-pi-remote` 에 남는다.

그 밖에:

- pi 확장은 `~/.pi/agent/extensions/` 에 있는 보통 파일이라 직접 지운다. 이름은 `sh pi-extension/install.sh --list` 로 본다. 지운 뒤 pi 에서 `/reload` 한다.
- tmux 세션은 그대로 남는다. 필요 없으면 `tmux kill-session -t antenna` 로 닫는다(그 안에서 돌던 것도 함께 끝난다).
- [선택 기능](#선택-기능)을 깔았으면 각 절의 빼기대로 뺀다.
- 폰에서는 앱을 지운다. 맥의 설정 폴더를 지웠으면 폰이 받았던 토큰은 더 쓸 수 없다.
- 저장소 폴더는 마지막에 지운다.

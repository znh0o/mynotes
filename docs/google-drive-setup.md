# Google Drive 연결 준비

Notelin의 Android 앱은 Google Identity Services로 사용자에게 `drive.appdata`와
`userinfo.email` 권한을 요청합니다. 액세스 토큰과 비밀번호를 Notelin 설정이나
IndexedDB에 저장하지 않습니다. Drive 백업은 Google Drive의 숨겨진 앱 전용 공간을
사용하므로 일반 Drive 파일 목록에는 표시되지 않습니다.

## 배포자가 한 번 설정할 것

1. Google Cloud Console에서 프로젝트를 만들고 **Google Drive API**를 사용 설정합니다.
2. Google Auth Platform의 앱 이름, 홈페이지, 개인정보 처리방침 등 동의 화면을 설정합니다.
3. Android OAuth 클라이언트를 만듭니다.
   - 패키지 이름: `app.notelin.android`
   - 릴리스 APK 서명 인증서 SHA-1: `83:E5:11:8F:36:CB:26:28:DF:FD:42:B4:FF:61:B0:E6:B5:91:C9:37`
4. 앱이 테스트 상태라면 사용할 Google 계정을 테스트 사용자로 추가합니다.
5. 실제 APK에서 **설정 → Google Drive → 계정 연결**을 눌러 권한 요청을 확인합니다.

서재 오른쪽 위 프로필에서도 계정을 연결할 수 있으며, 연결하면 동기화가 바로
시작됩니다. 프로필의 **로그아웃**은 Google Play 서비스에 이 앱의 권한 철회를
요청하고 자동 동기화를 끕니다. 기기와 Drive에 저장된 노트는 지우지 않습니다.
Google 비밀번호와 액세스 토큰은 앱 저장소에 보관하지 않습니다. 노트 파일 자체는
별도의 종단 간 암호화를 적용하지 않으므로 Google 계정 연결을 앱 잠금으로
간주해서는 안 됩니다.

디버그 APK는 서명 인증서가 달라 별도의 Android OAuth 클라이언트가 필요합니다.
릴리스 서명 키를 새로 만들거나 교체하면 이미 설치된 앱의 업데이트와 OAuth 연결이
모두 깨질 수 있으므로 기존 키를 그대로 사용해야 합니다.

노트와 PDF/이미지는 파일별로 전송하며, 동시 편집된 노트는 충돌 사본으로 보존합니다.
Drive에서 사라진 노트는 이 기기에서 휴지통으로 이동하고, 이 기기에서 영구 삭제한
노트는 다음 동기화 때 Drive에서도 삭제됩니다. 수동 전체 백업·사본 복원도 별도로
제공하며, 이 전체 백업은 400MB 이하만 복원할 수 있습니다.

실제 Google 계정, 여러 Android 기기, 큰 PDF와 네트워크 중단에서의 동작은 OAuth
프로젝트 설정과 기기 테스트가 완료되기 전까지 검증되지 않았습니다. 테스트 후
배포해야 합니다.

참고: [Android 권한 요청](https://developer.android.com/identity/authorization),
[Drive 앱 전용 폴더](https://developers.google.com/workspace/drive/api/guides/appdata),
[Drive API 사용 설정](https://developers.google.com/workspace/guides/enable-apis).

# DevLink Frontend

React · TypeScript · Vite로 만든 계정·팀·Agent 관리 화면입니다. 현재 백엔드 REST API를 직접 사용해 1차 MVP의 준비 과정을 확인할 수 있습니다.

## 구현 범위

- 회원가입, 세션 로그인, 내 정보 확인, 로그아웃
- 내 팀 목록, 팀 생성, 초대코드 참여, 팀 상세·팀원 조회
- OWNER의 초대코드 재발급과 코드 복사
- 팀 Agent 등록, 목록·상세·접속 상태 조회
- 본인 Agent의 연결 토큰 발급·재발급
- 요청 중 표시, 입력 검증, 빈 화면, 서버 오류·세션 만료 처리

MCP 도구 호출, 브로커 실행, 실제 AI 작업 요청·수행은 이 화면에 포함하지 않습니다. 아직 백엔드에 없는 작업 목록·완료 결과 조회 API를 가짜 데이터로 표시하지 않습니다.

## 로컬 실행

Node.js와 프로젝트의 npm 의존성, JDK 21, 실행 중인 Docker Desktop이 필요합니다.

먼저 백엔드 폴더에서 PostgreSQL과 서버를 실행합니다.

```powershell
cd C:\Users\SSAFY\Desktop\DevLink_server
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d postgres
.\gradlew.bat bootRun --args="--spring.profiles.active=local"
```

다른 PowerShell에서 프론트를 실행합니다.

```powershell
cd C:\Users\SSAFY\Desktop\DevLink_FrontEnd
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm install
npm run dev
```

기존에 의존성이 설치되어 있다면 `npm install`은 생략합니다. 터미널에 표시되는 Vite의 Local 주소로 접속합니다.

### 로컬 API 연결

기본값은 `VITE_API_BASE_URL`을 비워두고 Vite 개발 서버가 `/api` 요청을 `http://localhost:8080`으로 전달하는 방식입니다. 브라우저에서는 같은 출처로 요청하므로 로컬 프론트용 백엔드 CORS 변경 없이 세션 쿠키를 사용할 수 있습니다.

개발 프록시는 백엔드로 보낼 때 Origin 헤더를 제거합니다. 로컬 동일 출처 요청을 백엔드가 외부 Origin으로 판단해 거부하는 상황을 피하기 위한 개발 설정이며, 백엔드의 세션·CSRF 검사는 그대로 적용됩니다. 이 프록시는 운영 배포에 제공되지 않습니다.

백엔드 포트가 다르면 프론트의 `.env.local`을 변경한 뒤 개발 서버를 다시 실행합니다.

```dotenv
VITE_API_BASE_URL=
DEVLINK_API_PROXY_TARGET=http://localhost:8080
```

## 배포 연결

Vercel 프로젝트의 프레임워크는 **Vite**, 빌드 명령은 `npm run build`, 출력 폴더는 `dist`로 설정합니다. 화면은 단일 루트 페이지 안에서 전환하므로 별도의 클라이언트 라우팅 재작성 설정은 필요하지 않습니다.

Vercel 등에서 프론트를 배포할 때 `VITE_API_BASE_URL`을 실제 HTTPS 백엔드 Origin으로 설정한 뒤 배포합니다. `/api` 또는 `/api/v1` 경로는 붙이지 않습니다.

```dotenv
VITE_API_BASE_URL=https://api.example.com
```

위 주소는 예시입니다. 실제 운영 백엔드 주소로 교체해야 합니다. `VITE_` 환경변수는 브라우저에 공개되므로 비밀번호나 Agent 토큰을 넣지 않습니다.

환경변수는 빌드 시 반영되므로 값을 바꾸면 다시 배포해야 합니다. 로컬 `.env.local`은 Vercel 프로젝트 환경변수를 대신하지 않습니다. 개발용 프록시는 `npm run dev`에서만 동작하며 `preview`와 Vercel 정적 배포에서는 사용하지 않습니다.

백엔드에는 프론트 Origin의 CORS 허용, 쿠키 포함 요청 허용, HTTPS 및 운영 세션 쿠키 정책이 필요합니다. 현재 백엔드의 기본 허용 주소는 `https://devlinkfrontend.vercel.app`, `https://devlink.ai.kr`입니다. 서로 다른 사이트 사이에서는 브라우저의 서드파티 쿠키 정책에 따라 세션 사용이 제한될 수 있습니다.

## 인증과 토큰 처리

- 모든 API 요청에서 `credentials: include` 사용
- 상태 변경 요청 직전 CSRF 토큰 조회 후 응답의 헤더 이름·토큰으로 요청
- 로그인·로그아웃으로 세션이 바뀌어도 다음 요청에서 CSRF 재조회
- 새로고침 시 내 정보 API로 세션 복원
- 사용자 비밀번호·세션 식별자·Agent 토큰을 브라우저 저장소에 보관하지 않음
- 발급한 Agent 토큰은 현재 화면의 메모리에서만 확인·복사 가능
- 토큰 재발급 시 기존 토큰과 연결이 무효화될 수 있으므로 발급 전 안내 확인
- 생성·발급 요청의 결과가 불명확하면 자동 재전송하지 않고 목록을 확인하도록 안내

## A/B 수동 확인 순서

1. 일반 브라우저 창에서 A 회원가입 후 로그인합니다.
2. A가 팀을 생성하고 최초 초대코드를 복사합니다.
3. 시크릿 창이나 다른 브라우저에서 B 회원가입 후 로그인합니다.
4. B가 복사한 코드로 팀에 참여합니다.
5. 양쪽에서 새로고침하여 같은 팀원 목록을 확인합니다.
6. 각자 Agent를 등록하고 서로의 Agent 목록·역할·프로젝트를 확인합니다.
7. 본인 Agent의 토큰을 발급하고 화면에서 복사합니다.
8. A만 초대코드를 재발급할 수 있고, B는 본인 Agent의 토큰만 발급할 수 있는지 확인합니다.
9. 로그아웃 후 새로고침했을 때 로그인 화면으로 돌아오는지 확인합니다.

같은 브라우저의 일반 탭 여러 개는 로그인 쿠키를 공유합니다. A/B 동시 확인에는 일반 창과 시크릿 창, 또는 서로 다른 브라우저를 사용합니다.

Agent 등록만으로 ONLINE이 되지는 않습니다. 실제 브로커의 접속 보고가 없으면 OFFLINE이 정상입니다. 웹 로그아웃은 사용자 세션을 종료하며 Agent 토큰을 폐기하지 않습니다.

## 검증 상태

이번 구현에서는 빌드·테스트·서버 실행·의존성 설치를 수행하지 않았습니다. 코드와 API 계약에 대한 정적 검토만 수행했습니다.

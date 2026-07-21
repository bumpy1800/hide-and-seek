# Hide & Seek — Blend

최대 8명 멀티플레이 숨바꼭질. 술래는 랜덤 배정되고, 숨는 사람은 AI 군중과 **동일한 외형**으로 연기합니다. 술래는 어색한 움직임으로 사람을 가려내 잡습니다.

## 스택
- Client: TypeScript + Vite + Phaser 3
- Server: Node.js WebSocket (authoritative rooms)
- Shared: pure match rules (Vitest)

## 규칙
- 방 최대 **8** 인간 플레이어
- 시작 시 인간 중 **랜덤 술래**
- 맵에 다수의 **AI 군중** (히더와 동일 스프라이트)
- **제한 시간** 만료 시 히더 승리
- **잡기 횟수** 소진 시 히더 승리 (AI를 잡으면 횟수만 소모)
- 인간 히더를 모두 잡으면 술래 승리

## 조작
| 입력 | 동작 |
|------|------|
| WASD / 방향키 / 터치 스틱 | 이동 |
| Space / CATCH 버튼 | 잡기 (술래) |
| Enter | 매치 시작 (로비) |

## 로컬 실행
```bash
npm install
npm run dev:server   # :8787  (static+ws when built)
npm run dev          # :5173  Vite client
# or production-like:
npm run build && npm run start:server
```

## 테스트
```bash
npm test
```

## 배포
- GitHub: https://github.com/bumpy1800/hide-and-seek
- Client (Vercel): https://hide-and-seek-jet.vercel.app
- Full stack (WS host serving client): run `node packages/server/dist/index.js` and expose port 8787 (Docker included)

```bash
docker build -t hide-and-seek .
docker run -p 8787:8787 hide-and-seek
```

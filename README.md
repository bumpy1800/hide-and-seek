# Hide & Seek — Blend

최대 8명 멀티플레이 숨바꼭질. 술래는 랜덤 배정되고, 숨는 사람은 AI 군중과 **동일한 외형**으로 연기합니다. 술래는 어색한 움직임으로 사람을 가려내 잡습니다.

## Play
- **Client (Vercel):** https://hide-and-seek-jet.vercel.app  
- **Full stack (static + WebSocket):** https://proxy-examined-kept-humanity.trycloudflare.com  
  (Cloudflare quick tunnel → local authoritative server; re-run tunnel when offline)
- **Source:** https://github.com/bumpy1800/hide-and-seek

## Stack
- Client: TypeScript + Vite + Phaser 3
- Server: Node.js WebSocket (authoritative rooms, max 8 humans)
- Shared: pure match rules (Vitest)

## Rules
- Room cap **8** human players
- Random seeker among humans on start
- AI crowd uses the **same sprite** as human hiders (seeker is red/distinct)
- Time limit → hiders win if any human hider alive
- Catch budget exhausted → hiders win (catching AI wastes a charge)
- All human hiders caught → seeker wins

## Controls
| Input | Action |
|------|------|
| WASD / Arrows / Touch stick | Move |
| Space / CATCH button | Catch (seeker) |
| Enter | Start match (lobby) |

## Local
```bash
npm install
npm run build
npm run start:server   # http://localhost:8787  (client + ws)
# or split:
npm run dev:server
npm run dev
npm test
```

## Docker
```bash
docker build -t hide-and-seek .
docker run -p 8787:8787 hide-and-seek
```

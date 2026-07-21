# Hide and Seek (Blend)

Multiplayer hide-and-seek where one random seeker must catch human hiders blending with AI crowd.

## Stack
- Client: TypeScript + Vite + Phaser 3
- Server: Node WebSocket (authoritative rooms)
- Shared: pure match rules

## Scripts
```bash
npm install
npm run dev:server   # ws://localhost:8787
npm run dev          # http://localhost:5173
npm test
npm run build
```

## Controls
- Move: WASD / Arrow keys / on-screen touch pad
- Catch (seeker): Space / Catch button

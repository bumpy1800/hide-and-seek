import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('MenuScene create room UI', () => {
  it('uses in-scene modal instead of window.prompt for host room settings', () => {
    const src = readFileSync(resolve(__dirname, 'MenuScene.ts'), 'utf8');
    expect(src).toMatch(/openCreateRoomModal|createModal/);
    expect(src).toMatch(/confirmCreateRoom/);
    expect(src).toMatch(/방 생성/);
    expect(src).toMatch(/잡기 횟수/);
    expect(src).toMatch(/제한 시간/);
    expect(src).toMatch(/AI 토끼/);
    expect(src).toMatch(/여우 선정|룰렛|지정/);
    // createHostRoom must not drive sequential browser prompts
    const createFn = src.slice(
      src.indexOf('private createHostRoom'),
      src.indexOf('private openCreateRoomModal'),
    );
    expect(createFn).not.toMatch(/window\.prompt/);
    expect(createFn).toMatch(/openCreateRoomModal/);
  });

  it('clears createModal/rows on create and SHUTDOWN (lobby re-entry safe)', () => {
    const src = readFileSync(resolve(__dirname, 'MenuScene.ts'), 'utf8');
    expect(src).toMatch(/clearTransientUi/);
    // create() must reset before building UI
    const createBody = src.slice(src.indexOf('create(): void'), src.indexOf('private nickLine'));
    expect(createBody).toMatch(/clearTransientUi\(\)/);
    expect(createBody).toMatch(/SHUTDOWN[\s\S]*clearTransientUi/);
    // clearTransientUi nulls modal so openCreateRoomModal rebuilds (not setVisible on dead objects)
    const clearBody = src.slice(
      src.indexOf('clearTransientUi'),
      src.indexOf('private nickLine'),
    );
    expect(clearBody).toMatch(/createModal\s*=\s*null/);
    expect(clearBody).toMatch(/this\.rows\s*=\s*\[\]/);
    expect(clearBody).toMatch(/createModal\.destroy|createModal\)\.destroy/);
  });
});

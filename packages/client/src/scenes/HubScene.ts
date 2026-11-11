import Phaser from 'phaser';

export type HubGameCard = {
  id: string;
  title: string;
  subtitle: string;
  color: number;
  /** Phaser scene key to start */
  sceneKey: 'Menu' | 'MeteorMenu';
  enabled: boolean;
};

const GAMES: HubGameCard[] = [
  {
    id: 'hide-and-seek',
    title: 'AI 술래잡기',
    subtitle: '초원 숨바꼭질 · 멀티 · 연습 · 닉네임은 게임 안에서',
    color: 0x27ae60,
    sceneKey: 'Menu',
    enabled: true,
  },
  {
    id: 'meteor-dodge',
    title: '운석 피하기',
    subtitle: '닷지 스타일 총알 피하기 · 싱글/멀티 기록경쟁',
    color: 0x1e3a8a,
    sceneKey: 'MeteorMenu',
    enabled: true,
  },
];

/**
 * Snack Games hub — pick a mini-game only (no global nickname).
 * Boot → Hub → (AI 술래잡기) Menu → Game
 */
export class HubScene extends Phaser.Scene {
  constructor() {
    super('Hub');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0f172a');

    if (this.textures.exists('grass_tile')) {
      for (let y = 0; y < height; y += 64) {
        for (let x = 0; x < width; x += 64) {
          this.add
            .image(x + 32, y + 32, 'grass_tile')
            .setDisplaySize(64, 64)
            .setAlpha(0.35);
        }
      }
    }

    this.add
      .text(width / 2, 72, '스낵게임', {
        fontSize: '48px',
        color: '#fff8e7',
        fontStyle: 'bold',
        stroke: '#0b1020',
        strokeThickness: 8,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 128, 'Snack Games · 짧은 멀티·연습 미니게임', {
        fontSize: '18px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 190, '게임 선택', {
        fontSize: '22px',
        color: '#f1c40f',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const cardW = Math.min(520, width - 80);
    const cardH = 100;
    let y = 270;
    for (const game of GAMES) {
      this.makeGameCard(width / 2, y, cardW, cardH, game);
      y += cardH + 24;
    }

    this.add
      .text(width / 2, height - 40, '닉네임은 각 게임 화면에서 설정합니다', {
        fontSize: '14px',
        color: '#64748b',
      })
      .setOrigin(0.5);
  }

  private makeGameCard(
    x: number,
    y: number,
    w: number,
    h: number,
    game: HubGameCard,
  ): void {
    const bg = this.add
      .rectangle(x, y, w, h, game.color, game.enabled ? 0.95 : 0.45)
      .setStrokeStyle(2, game.enabled ? 0xf1c40f : 0x64748b, 0.7);

    this.add
      .text(x - w / 2 + 28, y - 14, game.title, {
        fontSize: '26px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5);

    this.add
      .text(x - w / 2 + 28, y + 18, game.subtitle, {
        fontSize: '15px',
        color: '#e2e8f0',
      })
      .setOrigin(0, 0.5);

    if (game.enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(game.color, 1));
      bg.on('pointerout', () => bg.setFillStyle(game.color, 0.95));
      bg.on('pointerdown', () => {
        this.scene.start(game.sceneKey);
      });
      this.add
        .text(x + w / 2 - 28, y, '플레이 →', {
          fontSize: '18px',
          color: '#fff8e7',
          fontStyle: 'bold',
        })
        .setOrigin(1, 0.5);
    } else {
      this.add
        .text(x + w / 2 - 28, y, '준비 중', {
          fontSize: '16px',
          color: '#94a3b8',
        })
        .setOrigin(1, 0.5);
    }
  }
}

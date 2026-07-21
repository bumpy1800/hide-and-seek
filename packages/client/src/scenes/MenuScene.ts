import Phaser from 'phaser';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height * 0.22, 'HIDE & SEEK', {
        fontSize: '48px',
        color: '#ecf0f1',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        height * 0.36,
        '한 명이 랜덤 술래가 됩니다.\n숨는 사람은 AI 군중과 똑같이 보여야 합니다.\n술래는 어색한 사람을 찾아 잡으세요!',
        { fontSize: '18px', color: '#bdc3c7', align: 'center', lineSpacing: 8 },
      )
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        height * 0.55,
        '제한 시간 · 잡기 횟수 제한 · 최대 8명\n이동: WASD/방향키/터치 스틱 · 잡기: Space/버튼',
        { fontSize: '16px', color: '#95a5a6', align: 'center', lineSpacing: 6 },
      )
      .setOrigin(0.5);

    const btn = this.add
      .rectangle(width / 2, height * 0.75, 220, 56, 0x27ae60)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(width / 2, height * 0.75, 'PLAY', {
        fontSize: '24px',
        color: '#fff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const go = () => this.scene.start('Game');
    btn.on('pointerdown', go);
    this.input.keyboard?.once('keydown-ENTER', go);
    this.input.keyboard?.once('keydown-SPACE', go);
  }
}

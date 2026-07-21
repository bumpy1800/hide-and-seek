import Phaser from 'phaser';
import {
  collectBrowserMobileSignals,
  shouldShowMobileKeypad,
  type ClientIntent,
} from '@hide-and-seek/shared';

/**
 * Unified keyboard + (mobile-only) touch pad → ClientIntent move/catch.
 */
export class IntentInput {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
  };
  private space!: Phaser.Input.Keyboard.Key;
  private stick = { dx: 0, dy: 0 };
  private catchQueued = false;
  private base!: Phaser.GameObjects.Arc;
  private knob!: Phaser.GameObjects.Arc;
  private catchBtn!: Phaser.GameObjects.Container;
  private activePointerId: number | null = null;
  private readonly stickCenter = { x: 100, y: 0 };
  private readonly stickRadius = 56;
  private readonly mobileKeypad: boolean;
  private touchEnabled = false;

  constructor(private scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (!kb) {
      throw new Error('Keyboard plugin missing');
    }
    this.cursors = kb.createCursorKeys();
    this.wasd = {
      w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.space = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.mobileKeypad = shouldShowMobileKeypad(
      collectBrowserMobileSignals(
        typeof navigator !== 'undefined' ? navigator : {},
        typeof window !== 'undefined' ? window : {},
      ),
    );

    const h = scene.scale.height;
    this.stickCenter.y = h - 100;

    this.base = scene.add
      .circle(this.stickCenter.x, this.stickCenter.y, this.stickRadius, 0x000000, 0.35)
      .setScrollFactor(0)
      .setDepth(1000)
      .setInteractive();
    this.knob = scene.add
      .circle(this.stickCenter.x, this.stickCenter.y, 28, 0xffffff, 0.55)
      .setScrollFactor(0)
      .setDepth(1001);

    const btnX = scene.scale.width - 90;
    const btnY = h - 100;
    const btnBg = scene.add.circle(0, 0, 40, 0xe74c3c, 0.85);
    const btnLabel = scene.add
      .text(0, 0, 'CATCH', { fontSize: '14px', color: '#fff', fontStyle: 'bold' })
      .setOrigin(0.5);
    this.catchBtn = scene.add
      .container(btnX, btnY, [btnBg, btnLabel])
      .setScrollFactor(0)
      .setDepth(1000)
      .setSize(80, 80)
      .setInteractive(
        new Phaser.Geom.Circle(0, 0, 40),
        Phaser.Geom.Circle.Contains,
      );

    this.catchBtn.on('pointerdown', () => {
      if (!this.mobileKeypad || !this.touchEnabled) return;
      this.catchQueued = true;
    });

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.mobileKeypad || !this.touchEnabled) return;
      if (p.x < scene.scale.width * 0.45) {
        this.activePointerId = p.id;
        this.updateStick(p.x, p.y);
      }
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.mobileKeypad || !this.touchEnabled) return;
      if (this.activePointerId === p.id && p.isDown) {
        this.updateStick(p.x, p.y);
      }
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.activePointerId === p.id) {
        this.activePointerId = null;
        this.stick.dx = 0;
        this.stick.dy = 0;
        this.knob.setPosition(this.stickCenter.x, this.stickCenter.y);
      }
    });

    this.space.on('down', () => {
      this.catchQueued = true;
    });

    // Initial: hide touch chrome on desktop; catch visibility set by GameScene for seeker
    this.setKeypadVisible(this.mobileKeypad);
  }

  get showsMobileKeypad(): boolean {
    return this.mobileKeypad;
  }

  private setKeypadVisible(visible: boolean): void {
    this.base.setVisible(visible);
    this.knob.setVisible(visible);
    // catch button visibility is role-gated separately; base hide when not mobile
    if (!visible) {
      this.catchBtn.setVisible(false);
      this.touchEnabled = false;
    } else {
      this.touchEnabled = true;
    }
  }

  private updateStick(x: number, y: number): void {
    const dx = x - this.stickCenter.x;
    const dy = y - this.stickCenter.y;
    const dist = Math.hypot(dx, dy);
    const max = this.stickRadius;
    const cl = dist > max ? max / dist : 1;
    const kx = this.stickCenter.x + dx * cl;
    const ky = this.stickCenter.y + dy * cl;
    this.knob.setPosition(kx, ky);
    const nd = dist > 8 ? dist : 0;
    this.stick.dx = nd ? (dx * cl) / max : 0;
    this.stick.dy = nd ? (dy * cl) / max : 0;
  }

  poll(): ClientIntent[] {
    const intents: ClientIntent[] = [];
    let dx = this.mobileKeypad ? this.stick.dx : 0;
    let dy = this.mobileKeypad ? this.stick.dy : 0;

    if (this.cursors.left?.isDown || this.wasd.a.isDown) dx -= 1;
    if (this.cursors.right?.isDown || this.wasd.d.isDown) dx += 1;
    if (this.cursors.up?.isDown || this.wasd.w.isDown) dy -= 1;
    if (this.cursors.down?.isDown || this.wasd.s.isDown) dy += 1;

    intents.push({ type: 'move', dx, dy });

    if (this.catchQueued) {
      intents.push({ type: 'catch' });
      this.catchQueued = false;
    }
    return intents;
  }

  /** Catch button only on mobile seeker (or practice never). */
  setCatchVisible(visible: boolean): void {
    this.catchBtn.setVisible(this.mobileKeypad && visible);
  }

  destroy(): void {
    this.base.destroy();
    this.knob.destroy();
    this.catchBtn.destroy();
  }
}

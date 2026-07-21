import Phaser from 'phaser';
import { createGameConfig } from './config';

const parent = document.getElementById('app') ?? document.body;
// eslint-disable-next-line no-new
new Phaser.Game(createGameConfig(parent));

import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'spatium-test-'));
const children = [];
function start(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, SPATIUM_DATA_DIR: directory, SPATIUM_API_ORIGIN: 'http://127.0.0.1:18767' } });
  children.push(child);
  return child;
}
async function ready(url, child) {
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, 'server exited during startup');
    if (await fetch(url).then(r => r.ok).catch(() => false)) return;
    await wait(100);
  }
  throw new Error('Server startup timed out');
}

const url = 'http://127.0.0.1:18767';
let browser;
try {
  const backend = start('.venv/bin/python', ['-m', 'uvicorn', 'tests.browser_server:app', '--port', '18767']);
  await ready(url + '/api/health', backend);
  const vite = start('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '18768', '--strictPort']);
  await ready('http://127.0.0.1:18768/api/health', vite);
  assert.equal((await (await fetch('http://127.0.0.1:18768/api/health')).json()).status, 'ok');
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({viewport: {width: 1300, height: 1000}, reducedMotion: 'reduce'});
  await page.addInitScript(() => {
    const now = performance.now.bind(performance);
    const raf = window.requestAnimationFrame;
    performance.now = () => window.fixtureTime ?? now();
    window.requestAnimationFrame = cb => raf(t => cb(window.fixtureTime ?? t));
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.getByLabel('Experience').selectOption('still');
  await page.getByRole('button', {name: 'Play motion'}).waitFor();
  await page.waitForFunction(() => document.querySelector('.frame canvas')?.width > 200);
  const frame = page.locator('.frame');
  const snapshot = async () => {
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    return frame.screenshot();
  };
  const home = await snapshot();
  await wait(120);
  assert.deepEqual(await snapshot(), home);
  await frame.press('ArrowRight');
  await frame.evaluate(el => el.blur());
  assert.notDeepEqual(await snapshot(), home);
  const reset = async () => {
    await page.getByRole('button', {name: 'Reset'}).click();
    assert.deepEqual(await snapshot(), home);
  };
  await reset();
  const bounds = await frame.boundingBox();
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 190, y);
  await page.mouse.up();
  await frame.evaluate(el => el.blur());
  const moved = await snapshot();
  assert.notDeepEqual(moved, home);
  if (process.env.SPATIUM_INSPECT_FRAME) await frame.screenshot({path: process.env.SPATIUM_INSPECT_FRAME});
  await page.mouse.down();
  await page.mouse.move(x + 240, y);
  await page.mouse.up();
  await frame.evaluate(el => el.blur());
  assert.deepEqual(await snapshot(), moved);
  await reset();
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -600);
  assert.notDeepEqual(await snapshot(), home);
  await reset();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: points});
  await touch('touchStart', [{x:x-12,y,id:1}, {x:x+12,y,id:2}]);
  await touch('touchMove', [{x:x-45,y,id:1}, {x:x+45,y,id:2}]);
  await touch('touchEnd', []);
  await frame.evaluate(el => el.blur());
  assert.notDeepEqual(await snapshot(), home);
  await reset();
  await page.getByRole('button', {name: 'Play motion'}).click();
  await page.getByRole('button', {name: 'Pause motion'}).click();
  await reset();
  await page.setViewportSize({width:375,height:812});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({width:1300,height:1000});
  async function verifyExport(name, width, height) {
    const path = join(directory, name + '.webm');
    const downloaded = page.waitForEvent('download', {timeout: 90000});
    await page.getByRole('button', {name:'Download WebM'}).click();
    await (await downloaded).saveAs(path);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-count_frames','-show_streams','-show_format','-of','json',path]));
    assert.equal(probe.streams.length, 1);
    const [video] = probe.streams;
    assert.deepEqual([video.codec_name, video.width, video.height, Number(video.nb_read_frames)], ['vp8',width,height,180]);
    assert.equal(Number(probe.format.duration), 6);
    // Capture exact playback poses for the same timestamps used by the encoder.
    await page.evaluate(() => { window.fixtureTime = 1000; });
    await page.getByRole('button', {name:'Play motion'}).click();
    for (const n of [0,90,179]) {
      await page.evaluate(t => { window.fixtureTime = t; }, 1000 + n / 179 * 6000);
      await snapshot();
      await frame.screenshot({path:join(directory, name + n + '.png')});
    }
    await page.evaluate(() => { delete window.fixtureTime; });
    execFileSync('.venv/bin/python', ['tests/check_frames.py', path]);
  }
  await page.evaluate(() => {
    const configure = VideoEncoder.prototype.configure;
    VideoEncoder.prototype.configure = function() {
      VideoEncoder.prototype.configure = configure;
      throw new Error('Encoder fixture failure');
    };
  });
  await page.getByRole('button', {name:'Download WebM'}).click();
  await page.locator('.viewer [role=status]').waitFor();
  await verifyExport('landscape',960,640);
  await frame.locator('canvas').evaluate(el => el.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.getByText('3D preview is unavailable.', {exact: false}).waitFor();
  assert(await frame.locator('img').isVisible());
  await page.locator('input[type=file]').setInputFiles({
    name: 'source.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await (await fetch(url + '/api/demo/still')).arrayBuffer())
  });
  await page.getByLabel('Magic Hour API key').fill('fixture');
  await page.getByRole('button', {name: 'Generate miniature'}).click();
  await page.getByText('5 credits charged').waitFor();
  await page.getByRole('button', {name: 'Resume existing edit'}).waitFor();
  await page.reload();
  await page.getByRole('button', {name: 'Resume existing edit'}).waitFor();
  assert.equal(await page.getByLabel('Magic Hour API key').inputValue(), '');
  await page.getByLabel('Magic Hour API key').fill('fixture');
  await page.getByRole('button', {name: 'Resume existing edit'}).click();
  await page.getByAltText('Stylized miniature').waitFor();
  await page.getByRole('button', {name: 'Retry depth'}).click();
  await page.getByText('Scene ready', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Play motion'}).waitFor();
  await verifyExport('portrait',440,640);
  const metrics = JSON.parse(execFileSync('.venv/bin/python', ['-m', 'spatium.metrics', directory]));
  assert.equal(metrics[0].exports, 1);
  assert.equal(metrics[0].depth_failures, 1);
  assert(metrics[0].interactive_seconds >= metrics[0].still_seconds);
  await page.evaluate(() => sessionStorage.setItem('spatium.scene', 'expired'));
  await page.reload();
  await page.getByText('Scene not found or expired.').waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('spatium.scene')), null);
  await page.getByRole('button', {name:'Turn around'}).waitFor();
  const tourFrame = page.locator('.tour-frame');
  const capture = async () => {
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    return tourFrame.locator('canvas').screenshot();
  };
  const arrival = await capture();
  await page.getByRole('button',{name:'Turn around'}).click();
  assert.notDeepEqual(await capture(), arrival);
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  assert.deepEqual(await capture(), arrival);
  await page.locator('.waypoint').click();
  await page.locator('.tour-stops [aria-current=step]').filter({hasText:'Up close'}).waitFor();
  assert.notDeepEqual(await capture(), arrival);
  await page.getByRole('button',{name:'Turn around'}).click();
  await tourFrame.press('w');
  await page.locator('.tour-stops [aria-current=step]').filter({hasText:'Arrival'}).waitFor();
  await page.locator('input[type=file]').setInputFiles('public/assets/walkthrough/stop-0.jpg');
  await page.getByLabel('Magic Hour API key').fill('fixture');
  await page.getByRole('button',{name:'Generate walkthrough'}).click();
  await page.getByText('15 credits charged').waitFor();
  await page.getByRole('button',{name:'Play walkthrough'}).click();
  await page.getByRole('button',{name:'Pause walkthrough'}).click();
  await page.reload();
  await page.getByText('15 credits charged').waitFor();
  const tourDownload = page.waitForEvent('download',{timeout:150000});
  await page.getByRole('button',{name:'Download walkthrough'}).click();
  const tourPath = join(directory,'walkthrough.webm');
  await (await tourDownload).saveAs(tourPath);
  const clip = JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_format','-show_streams','-of','json',tourPath]));
  assert.equal(clip.streams.length,1);
  assert.equal(Number(clip.streams[0].nb_read_frames),300);
  assert.equal(Number(clip.format.duration),10);
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await Promise.all(children.filter(child => child.exitCode === null && !child.signalCode).map(child => {
    const ended = once(child, 'exit');
    child.kill();
    return ended;
  }));
  await rm(directory, {recursive: true, force: true});
}

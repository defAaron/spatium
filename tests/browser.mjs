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
  await page.getByRole('button', {name:'Turn around'}).waitFor();
  await page.setViewportSize({width:375,height:812});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({width:1300,height:1000});
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
  await page.waitForFunction(async () => (await (await fetch('/api/scenes/' + sessionStorage.getItem('spatium.scene'))).json()).stage === 'ready');
  const metrics = JSON.parse(execFileSync('.venv/bin/python', ['-m', 'spatium.metrics', directory]));
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].exports, 1);
  assert(metrics[0].ready_seconds >= metrics[0].first_stop_seconds);
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

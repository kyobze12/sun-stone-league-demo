import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('test-output',{recursive:true});
const server=spawn('node',['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1'],{stdio:'inherit'});
try {
  let ready=false;
  for(let i=0;i<50;i++){
    try {ready=(await fetch('http://127.0.0.1:4173')).ok;}catch{}
    if(ready)break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(ready,'preview server starts');
  for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
    const browser=await engine.launch();
    try {
      for(const [orientation,viewport] of [['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]){
        const context=await browser.newContext({viewport,hasTouch:true,isMobile:true});
        const page=await context.newPage(),errors=[];
        page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
        page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text());}});
        await page.goto('http://127.0.0.1:4173');
        await page.locator('#loading').waitFor({state:'hidden',timeout:30000});
        await page.getByRole('button',{name:/Solo Challenge/}).click();
        await page.locator('#countdown').waitFor({state:'hidden'});
        await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.up('w');
        await page.screenshot({path:'test-output/'+name+'-'+orientation+'.png'});
        await page.getByRole('button',{name:'Pause game'}).click();
        const before=await page.locator('#center-value').textContent();
        await page.waitForTimeout(1200);
        assert.equal(await page.locator('#center-value').textContent(),before,'timer freezes while paused');
        await page.getByRole('button',{name:'Resume game'}).click();
        await page.waitForFunction(value=>Number(document.getElementById('center-value').textContent)<Number(value),before,{timeout:10000});
        assert.deepEqual(errors,[],name+' runtime/shader errors');
        console.log(name+' '+orientation+': startup, movement, shaders and pause passed');
        await page.reload();
        await page.locator('#loading').waitFor({state:'hidden',timeout:30000});
        await page.getByRole('button',{name:/2v2 Team Match/}).click();
        await page.locator('#countdown').waitFor({state:'hidden'});
        assert.equal(await page.locator('#player-label').textContent(),'Sun Team');
        assert.equal(await page.locator('#rival-label').textContent(),'Rival Team');
        assert.equal(await page.locator('#touch-controls').isVisible(),true,'touch controls stay available in 2v2');
        await page.waitForTimeout(900);
        assert.deepEqual(errors,[],name+' 2v2 runtime/shader errors');
        console.log(name+' '+orientation+': 2v2 startup, team HUD and touch controls passed');
        await context.close();
      }
    } finally {await browser.close();}
  }
} finally {server.kill();}

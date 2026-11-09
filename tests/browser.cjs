'use strict';
// Requires a fixture-endpoint build, Playwright and Chromium; no vehicle transport.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {startFixture}=require('./mock-rosbridge.cjs');
const {chromium}=require(process.env.CARL_PLAYWRIGHT_MODULE||'playwright');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,timeout=10000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await predicate())return;await delay(50);}
  throw new Error(`Timed out: ${label}`);
}

(async()=>{
  const fixture=startFixture();
  const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3212'],{
    env:{...process.env,CARL_GUI_TEST_BUILD:'1'},stdio:['ignore','pipe','pipe'],
  });
  let output='';
  server.stdout.on('data',data=>{output=(output+data).slice(-4000);});
  server.stderr.on('data',data=>{output=(output+data).slice(-4000);});
  let browser;
  const results={checks:[],resources:{}};
  try{
    await until(async()=>{
      if(server.exitCode!==null)throw new Error(output);
      try{return(await fetch('http://127.0.0.1:3212')).ok;}catch{return false;}
    },'local test server');
    browser=await chromium.launch({headless:true,executablePath:process.env.CARL_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
    const context=await browser.newContext({viewport:{width:1024,height:600},timezoneId:'America/Los_Angeles'});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const external=[];page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:3212'))external.push(request.url());});
    const row=label=>page.locator('.detail-row').filter({has:page.locator('span',{hasText:new RegExp(`^${label}$`)})}).first().locator('strong');
    const nav=async name=>{
      await page.getByRole('button',{name,exact:true}).click();
      await page.locator(`.passenger-dashboard[data-page="${name}"]`).waitFor({state:'visible'});
    };
    const equalRow=async(label,value)=>until(async()=>await row(label).innerText()===value,`${label}: ${value}`);
    const indicator=async(name,health)=>until(async()=>await page.getByRole('img',{name:`${name} Teensy: ${health}`,exact:true}).count()===1,`${name} indicator: ${health}`);
    await page.goto('http://127.0.0.1:3212');
    await until(async()=>await page.locator('.status-indicator').first().innerText()==='Live','live heartbeat');
    await indicator('Throttle','Online');await indicator('Steering','Stale');
    assert.equal(await page.locator('.view-footer').count(),0,'Production footer labels removed');
    await page.screenshot({path:'.test-build/browser-drive.png',animations:'disabled'});
    await nav('Telemetry');
    await equalRow('CARL bridge endpoints','Detected');
    await equalRow('Vehicle mode','Teleop');
    await equalRow('Applied left','75.0 %');await equalRow('Applied right','-75.0 %');
    const first=await row('Rear left encoder').innerText();
    await until(async()=>await row('Rear left encoder').innerText()!==first,'changing encoders');
    fixture.setMode('steering');await equalRow('Steering angle','30.0 °');await equalRow('Steering sensor','Valid · calibrated');
    await indicator('Steering','Online');await equalRow('Throttle Teensy','Online');await equalRow('Steering Teensy','Online');
    fixture.setMode('steering-uncalibrated');await equalRow('Steering angle','—');await equalRow('Steering sensor','Valid · uncalibrated');
    await indicator('Steering','Online');
    await nav('Drive');await page.screenshot({path:'.test-build/browser-drive.png',animations:'disabled'});await nav('Telemetry');
    fixture.setMode('steering-fault');await indicator('Steering','Fault');await equalRow('Steering Teensy','Fault');
    fixture.setMode('steering');await indicator('Steering','Online');
    await page.locator('.telemetry-page').evaluate(el=>{el.scrollTop=0;});
    await page.screenshot({path:'.test-build/browser-telemetry.png',animations:'disabled'});
    results.checks.push('live topics, 75% signed throttle, changing encoders and calibrated steering');
    await equalRow('Acceleration X','1.250 m/s²'); await equalRow('Acceleration Y','-2.500 m/s²');
    await equalRow('Gyro Z','0.000 rad/s'); await equalRow('IMU die temperature','34.125 °C');
    await equalRow('Sensor model','MPU-9250'); await equalRow('Orientation','Not provided');
    await page.locator('#imu-data-title').scrollIntoViewIfNeeded();
    await page.screenshot({path:'.test-build/browser-imu.png',animations:'disabled'});
    fixture.setMode('imu-pause'); await equalRow('Motion stream','Stale'); await equalRow('Acceleration X','—');
    await equalRow('IMU diagnostics','Stale'); await equalRow('Heartbeat','Online');
    fixture.setMode('imu-malformed'); await equalRow('Motion stream','Unknown'); await equalRow('IMU diagnostics','Unknown');
    fixture.setMode('imu-fault'); await equalRow('IMU diagnostics','Fault'); await equalRow('Sensor error','data_timeout');
    fixture.setMode('imu-recovered'); await equalRow('IMU diagnostics','Online'); await equalRow('Sensor error count','5');
    fixture.setMode('live'); await equalRow('Acceleration X','1.250 m/s²');
    results.checks.push('IMU SI units, unavailable orientation, independent freshness, malformed data and sensor fault/recovery');


    fixture.setMode('pause');
    await equalRow('Heartbeat','Stale');await equalRow('Applied left','—');await equalRow('Steering angle','—');
    await indicator('Throttle','Stale');await indicator('Steering','Stale');
    fixture.setMode('live');await equalRow('Heartbeat','Online');
    fixture.setMode('malformed');await equalRow('Applied left','—');
    await indicator('Throttle','Unknown');
    fixture.setMode('estop');await equalRow('Emergency stop','Active');await equalRow('Throttle state','E-stop');
    await indicator('Throttle','Fault');
    fixture.setMode('live');await equalRow('Emergency stop','Clear');
    await indicator('Throttle','Online');
    results.checks.push('THR/STR healthy, uncalibrated, fault, stale, malformed and recovered lights; no production footer labels');
    results.checks.push('stale, malformed, e-stop and fresh-data recovery');

    fixture.disconnectClients();await until(()=>fixture.stats().connections>=2,'automatic reconnect');
    await equalRow('Heartbeat','Online');await until(()=>fixture.stats().subscriptions===7,'seven restored subscriptions');
    fixture.setMode('subscription-error');fixture.disconnectClients();
    await nav('System');await until(async()=>(await page.locator('.connection-settings').innerText()).includes('Unknown message type'),'subscription error surfaced');
    fixture.setMode('live');
    await page.getByRole('button',{name:'Retry connection',exact:true}).click();
    await nav('Telemetry');await equalRow('Applied left','75.0 %');
    results.checks.push('reconnect without duplicate subscriptions and visible subscription failures');

    await page.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await until(()=>fixture.stats().subscriptions===0,'hidden page unsubscribes');
    const hidden=fixture.stats().messages;await delay(500);assert.equal(fixture.stats().messages,hidden);
    await page.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:false});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await until(()=>fixture.stats().subscriptions===7,'visible page resumes');await equalRow('Heartbeat','Online');
    results.checks.push('hidden-page telemetry suspension and fresh resume');

    await nav('System');
    await page.getByRole('button',{name:'mph',exact:true}).click();
    await page.getByRole('switch',{name:'Use concept date & time'}).check();
    await page.getByRole('switch',{name:'24-hour clock'}).uncheck();
    assert.equal(await page.locator('.clock time').innerText(),'2:32 PM');
    await nav('Drive');assert.equal(await page.locator('.speed-unit').innerText(),'mph');
    await nav('System');assert.equal(await page.getByRole('button',{name:'mph',exact:true}).getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>{document.documentElement.requestFullscreen=()=>Promise.reject(new Error('Unsupported'));});
    await page.getByRole('button',{name:'Toggle fullscreen'}).click();
    await until(async()=>(await page.locator('.page-content').innerText()).includes('Fullscreen is unavailable'),'fullscreen rejection');
    await page.getByRole('switch',{name:'Use concept date & time'}).uncheck();
    results.checks.push('units, clock preferences, navigation persistence and fullscreen failure');

    const client=await context.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate',{rate:4});
    await client.send('Performance.enable');
    const metrics=async()=>Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    await nav('Drive');await delay(500);
    const before=await metrics(),messagesBefore=fixture.stats().messages;
    const seconds=Number(process.env.CARL_GUI_SOAK_SECONDS||10);
    assert.ok(seconds>=5&&seconds<=300);
    await delay(seconds*1000);
    const after=await metrics(),messages=fixture.stats().messages-messagesBefore;
    assert.ok(messages<=7*(seconds*10+3),`Server throttle budget exceeded: ${messages}`);
    assert.equal(fixture.stats().activeConnections,1);assert.equal(fixture.stats().subscriptions,7);
    results.resources={cpuThrottle:4,seconds,messages,taskSeconds:Number((after.TaskDuration-before.TaskDuration).toFixed(3)),heapMiB:Number((after.JSHeapUsedSize/1048576).toFixed(2)),heapDeltaMiB:Number(((after.JSHeapUsedSize-before.JSHeapUsedSize)/1048576).toFixed(2)),domNodes:after.Nodes};
    results.checks.push('bounded traffic and single connection under 4x CPU throttling');

    fixture.setMode('silent');const connections=fixture.stats().connections;
    await until(()=>fixture.stats().connections>connections,'half-open peer timeout',23000);
    fixture.setMode('live');await nav('Telemetry');await equalRow('Heartbeat','Online');
    results.checks.push('silent half-open peer replaced and live telemetry recovered');

    for(const path of ['/common','/sensor-data','/robot/tb3_0']){
      await page.goto(`http://127.0.0.1:3212${path}`);
      await page.waitForURL('http://127.0.0.1:3212/');
      await until(async()=>await page.locator('.status-indicator').first().innerText()==='Live',`legacy route ${path}`);
    }
    assert.equal(errors.length,0,errors.join('\n'));
    assert.deepEqual(external,[],'Runtime must not load fonts or scripts from the internet');
    assert.equal(fixture.stats().commands,0,'Read-only dashboard must never publish a vehicle command');
    results.checks.push('legacy redirects, no page errors, no internet assets, no vehicle commands');
    fs.writeFileSync('.test-build/browser-results.json',JSON.stringify(results,null,2)+'\n');
    console.log(JSON.stringify(results,null,2));
  }finally{
    await browser?.close();
    await fixture.close();
    server.kill('SIGTERM');
    if(server.exitCode===null)await once(server,'exit');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

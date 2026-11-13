'use strict';
// Requires a fixture-endpoint build, Playwright and Chromium; no vehicle transport.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {startFixture}=require('./mock-rosbridge.cjs');
const {chromium}=require(process.env.CARL_PLAYWRIGHT_MODULE||'playwright');
const QRCode=require('qrcode');

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
    let operation={state:'off',step:null,mode:null,error:null};
    let failNextStart=false;
    let rejectNextJoystick=false;
    let delayedStopOnce=false;
    let delayedStopJoystickReplyOnce=false;
    const joystickUrl='http://10.1.2.3:8001/';
    const joystickQr=await QRCode.toDataURL(joystickUrl);
    await context.route('**/api/joystick-link',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({url:joystickUrl,qr:joystickQr})}));
    await context.route('**/api/carl-control',async route=>{
      const request=route.request();
      if(request.method()==='POST'){
        const action=request.postDataJSON().action;
        if(action==='start-joystick' && rejectNextJoystick){
          rejectNextJoystick=false;
          await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({state:'fault',error:'CARL control service is running an older version.'})});
          return;
        }
        if(action==='start'){
          operation={state:'starting',step:'bridge',mode:null,error:null};
          setTimeout(()=>{if(operation.state==='starting')operation={state:'starting',step:'rosbridge',mode:null,error:null};},1000);
          setTimeout(()=>{if(operation.state==='starting')operation=failNextStart
            ? {state:'fault',step:null,mode:null,error:'ROS web bridge cannot use port 9090.'}
            : {state:'awaiting-mode',step:null,mode:null,error:null};},2000);
        }else if(action==='no-control' && operation.state==='awaiting-mode'){
          await delay(900);
          operation={state:'on',step:null,mode:'none',error:null};
        }
        else if(action==='start-joystick' && ((operation.state==='on'&&operation.mode==='none')||operation.state==='awaiting-mode')){
          operation={state:'joystick-starting',step:'joystick',mode:null,error:null};
          setTimeout(()=>{if(operation.state==='joystick-starting')operation={state:'on',step:null,mode:'joystick',error:null};},1000);
        }else if(action==='stop-joystick' && operation.mode==='joystick'){
          operation={state:'on',step:null,mode:'none',error:null};
          if(delayedStopJoystickReplyOnce){ delayedStopJoystickReplyOnce=false; await delay(900); }
        }
        else if(action==='stop'){
          if(delayedStopOnce){
            delayedStopOnce=false;
            setTimeout(()=>{operation={state:'off',step:null,mode:null,error:null};},1200);
          }else operation={state:'off',step:null,mode:null,error:null};
        }
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(operation)});
    });
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
    const startDashboard=async()=>{
      if(operation.state!=='on'){
        await page.getByRole('button',{name:'Start CARL'}).click();
        await page.getByRole('button',{name:'Joystick control'}).click();
      }
      await until(async()=>await page.locator('.passenger-dashboard').count()===1,'dashboard after welcome',12000);
    };
    await page.goto('http://127.0.0.1:3212');
    assert.deepEqual(await page.locator('.startup-title span').allTextContents(),['Autonomous','Systems','Lab']);
    assert.equal(await page.locator('.passenger-dashboard').count(),0,'Dashboard is hidden on first load');
    const startBounds=await page.getByRole('button',{name:'Start CARL'}).boundingBox();
    const exitBounds=await page.getByRole('button',{name:'Exit GUI'}).boundingBox();
    assert.ok(startBounds&&exitBounds);
    assert.ok(exitBounds.y+exitBounds.height<startBounds.y,'Exit GUI sits above Start CARL');
    assert.ok(Math.abs(exitBounds.x+exitBounds.width/2-startBounds.x-startBounds.width/2)<1,'Buttons share a center');
    await page.screenshot({path:'.test-build/browser-welcome.png',animations:'disabled'});
    assert.equal(await page.getByRole('button',{name:'Exit GUI'}).count(),1);
    await page.getByRole('button',{name:'Exit GUI'}).click();
    await until(async()=>await page.locator('.startup-close-error').innerText()==='This action is available only on the local passenger display.','local-only exit feedback');
    assert.equal(await page.getByRole('button',{name:'Start CARL'}).isEnabled(),true,'Failed exit leaves startup usable');
    await page.getByRole('button',{name:'Start CARL'}).click();
    await delay(200);
    assert.ok(Number(await page.locator('.startup-button').evaluate(el=>getComputedStyle(el).opacity))<1);
    assert.equal(await page.locator('.startup-title').count(),1,'Title remains during the hold');
    await page.locator('.startup-progress-row').first().waitFor({state:'visible',timeout:8000});
    assert.equal(await page.locator('.startup-progress').evaluate(el=>getComputedStyle(el).animationName),'startup-appear');
    assert.equal(await page.locator('.startup-wave-bars i').count(),5,'Active command uses five wave bars');
    assert.deepEqual(await page.locator('.startup-progress-row').allTextContents(),[
      'Connecting CARL hardware','Starting telemetry connection']);
    await page.screenshot({path:'.test-build/browser-starting.png',animations:'disabled'});
    await page.getByRole('button',{name:'Joystick control'}).waitFor({state:'visible',timeout:8000});
    await page.screenshot({path:'.test-build/browser-mode.png',animations:'disabled'});
    await page.getByRole('button',{name:'Joystick control'}).click();
    await page.locator('.startup-warning').waitFor({state:'visible',timeout:8000});
    assert.match(await page.locator('.startup-warning').innerText(),/physical E-stop/);
    await until(async()=>Number(await page.locator('.startup-warning').evaluate(el=>getComputedStyle(el).opacity))>=.99,'warning fully visible',2000);
    const warningFullyVisibleAt=Date.now();
    const titleBounds=await page.locator('.startup-title').boundingBox();
    const warningBounds=await page.locator('.startup-warning').boundingBox();
    assert.ok(titleBounds&&warningBounds&&warningBounds.y>titleBounds.y+titleBounds.height+50,'Warning stays below the title');
    await page.screenshot({path:'.test-build/browser-warning.png',animations:'disabled'});
    await until(async()=>await page.locator('.passenger-dashboard').count()===1,'dashboard after welcome',12000);
    assert.ok(Date.now()-warningFullyVisibleAt>=4700,'Warning remains fully visible for about five seconds');
    results.checks.push('welcome screen, Exit GUI request and error recovery, button fade and delayed dashboard');
    assert.deepEqual(await page.locator('.floating-dock button span').allTextContents(),['Telemetry','Drive','System']);
    assert.equal(await page.locator('.floating-dock button').nth(1).getAttribute('aria-current'),'page');
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
    assert.equal(await page.getByRole('button',{name:'Stop CARL',exact:true}).count(),1);
    await page.locator('.joystick-qr img').waitFor({state:'visible'});
    const qrBounds=await page.locator('.joystick-qr img').boundingBox();
    const contentBounds=await page.locator('.page-content').boundingBox();
    assert.ok(qrBounds&&contentBounds&&qrBounds.y+qrBounds.height<contentBounds.y+contentBounds.height,'Joystick QR code is fully visible without scrolling');
    const stopBounds=await page.getByRole('button',{name:'Stop CARL',exact:true}).boundingBox();
    assert.ok(stopBounds&&contentBounds&&stopBounds.y+stopBounds.height<contentBounds.y+contentBounds.height,'Stop CARL stays visible in System');
    for (const name of ['Start CARL Joystick','Stop CARL Joystick']) {
      const bounds=await page.getByRole('button',{name}).boundingBox();
      assert.ok(bounds&&contentBounds&&bounds.y+bounds.height<contentBounds.y+contentBounds.height,`${name} stays visible in System`);
    }
    await page.screenshot({path:'.test-build/browser-system-joystick.png',animations:'disabled'});
    assert.match(await page.locator('.joystick-qr').innerText(),/http:\/\/10\.1\.2\.3:8001\//);
    assert.equal(await page.getByRole('button',{name:'Start CARL Joystick'}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Stop CARL Joystick'}).isEnabled(),true);
    await page.getByRole('button',{name:'mph',exact:true}).click();
    assert.equal(await page.getByRole('switch',{name:'Use concept date & time'}).count(),0);
    await page.getByRole('switch',{name:'24-hour clock'}).uncheck();
    assert.match(await page.locator('.clock time').innerText(),/\d{1,2}:\d{2}\s*[AP]M/i);
    await nav('Drive');assert.equal(await page.locator('.speed-unit').innerText(),'mph');
    await nav('System');assert.equal(await page.getByRole('button',{name:'mph',exact:true}).getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>{document.documentElement.requestFullscreen=()=>Promise.reject(new Error('Unsupported'));});
    await page.getByRole('button',{name:'Toggle fullscreen'}).click();
    await until(async()=>(await page.locator('.page-content').innerText()).includes('Fullscreen is unavailable'),'fullscreen rejection');
    await page.getByRole('button',{name:'Close local GUI'}).click();
    assert.equal(await page.getByRole('button',{name:'Close GUI'}).count(),1,'System close confirmation remains available');
    await page.getByRole('button',{name:'Cancel'}).click();
    results.checks.push('centered Drive navigation, units, live clock, System close confirmation and fullscreen failure');

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
      await startDashboard();
      await until(async()=>await page.locator('.status-indicator').first().innerText()==='Live',`legacy route ${path}`);
    }
    assert.equal(errors.length,0,errors.join('\n'));
    assert.deepEqual(external,[],'Runtime must not load fonts or scripts from the internet');
    assert.equal(fixture.stats().commands,0,'Read-only dashboard must never publish a vehicle command');
    await nav('Drive');
    await page.getByRole('button',{name:'Stop CARL',exact:true}).click();
    await until(async()=>await page.getByRole('button',{name:'Start CARL'}).count()===1,'return to welcome after stop');
    await page.getByRole('button',{name:'Start CARL'}).click();
    await page.getByRole('button',{name:'No Control'}).click();
    await page.getByText('Confirming zero throttle').waitFor({state:'visible'});
    await page.locator('.startup-warning').waitFor({state:'visible',timeout:8000});
    await until(async()=>Number(await page.locator('.startup-warning').evaluate(el=>getComputedStyle(el).opacity))>=.99,'No Control warning fully visible',2000);
    const noControlWarningAt=Date.now();
    await page.screenshot({path:'.test-build/browser-warning-no-control.png',animations:'disabled'});
    await until(async()=>await page.locator('.passenger-dashboard').count()===1,'dashboard in no-control mode',12000);
    assert.ok(Date.now()-noControlWarningAt>=4700,'No Control warning remains fully visible for about five seconds');
    assert.equal(operation.mode,'none');
    await nav('System');
    assert.equal(await page.getByRole('button',{name:'Stop CARL Joystick'}).isDisabled(),true);
    await page.getByRole('button',{name:'Start CARL Joystick'}).click();
    await until(async()=>operation.mode==='joystick','joystick started from System');
    operation={state:'on',step:null,mode:'none',error:null}; // Simulated phone sign-out.
    await until(async()=>await page.getByRole('button',{name:'Start CARL Joystick'}).isEnabled(),'No Control shown after remote sign-out');
    assert.match(await page.locator('.joystick-settings').innerText(),/Mode: No Control/);
    await page.getByRole('button',{name:'Start CARL Joystick'}).click();
    await until(async()=>operation.mode==='joystick','joystick restarted in the same CARL session');
    await page.getByRole('button',{name:'Stop CARL Joystick'}).click();
    await until(async()=>operation.mode==='none','joystick stopped from System');
    await until(async()=>await page.getByRole('button',{name:'Stop CARL Joystick'}).isDisabled(),'Stop joystick button disabled');
    rejectNextJoystick=true;
    await page.getByRole('button',{name:'Start CARL Joystick'}).click();
    await until(async()=>await page.locator('.startup-error').count()===1,'old supervisor error screen');
    await delay(1500);
    assert.match(await page.locator('.startup-error').innerText(),/older version/);
    assert.equal(await page.locator('.passenger-dashboard').count(),0,'Stale running status cannot hide the error');
    await page.getByRole('button',{name:'Return to start'}).click();
    await until(async()=>await page.getByRole('button',{name:'Start CARL'}).count()===1,'welcome after joystick action error');
    results.checks.push('No Control startup, QR link, and guarded System joystick mode changes');
    await page.getByRole('button',{name:'Start CARL'}).click();
    await page.getByRole('button',{name:'Joystick control'}).click();
    await until(async()=>await page.locator('.passenger-dashboard').count()===1,'dashboard for stop sequence',12000);
    await nav('System');
    delayedStopJoystickReplyOnce=true;
    delayedStopOnce=true;
    await page.getByRole('button',{name:'Stop CARL Joystick'}).click();
    await page.getByRole('button',{name:'Stop CARL',exact:true}).click();
    await page.locator('.startup-message').waitFor({state:'visible'});
    await delay(1050);
    assert.equal(await page.locator('.passenger-dashboard').count(),0,'Late joystick reply cannot reopen Drive during Stop CARL');
    await page.locator('.startup-message-fading').waitFor({state:'attached',timeout:8000});
    await page.locator('.startup-welcome-appearing').first().waitFor({state:'attached',timeout:4000});
    await until(async()=>await page.getByRole('button',{name:'Start CARL'}).isEnabled(),'start available after stop fade');
    results.checks.push('Stop Joystick then Stop CARL ignores late running replies and fades to Start');
    failNextStart=true;
    await page.getByRole('button',{name:'Start CARL'}).click();
    await until(async()=>await page.locator('.startup-error').count()===1,'startup failure screen',12000);
    assert.match(await page.locator('.startup-error').innerText(),/ROS web bridge cannot use port 9090/);
    await page.getByRole('button',{name:'Return to start'}).click();
    await page.locator('.startup-error-fading').waitFor({state:'visible'});
    await until(async()=>await page.getByRole('button',{name:'Start CARL'}).count()===1,'welcome after failed startup');
    assert.equal(await page.locator('.startup-title').evaluate(el=>getComputedStyle(el).animationName),'startup-appear');
    results.checks.push('legacy redirects, no page errors, no internet assets, no vehicle commands');
    results.checks.push('startup failure shows specific error and returns to welcome after rollback');
    fs.writeFileSync('.test-build/browser-results.json',JSON.stringify(results,null,2)+'\n');
    console.log(JSON.stringify(results,null,2));
  }finally{
    await browser?.close();
    await fixture.close();
    server.kill('SIGTERM');
    if(server.exitCode===null)await once(server,'exit');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

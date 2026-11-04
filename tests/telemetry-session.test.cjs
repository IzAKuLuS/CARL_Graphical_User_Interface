'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TelemetrySession}=require('../.test-build/lib/passenger/telemetry-session.js');
const {ingest,projectTelemetry}=require('../.test-build/lib/passenger/telemetry-store.js');
const {clock}=require('./fakes.cjs');

function setup() {
  const time=clock(), active=new Map(), history=[];
  const port={subscribe(topic,type,callback,options) {
    const sub={topic,type,callback,options};
    history.push(sub); active.set(topic,sub);
    return ()=>{if(active.get(topic)===sub) active.delete(topic);};
  }};
  const session=new TelemetrySession(port,time);
  return {time,active,history,session,receive(key,value){active.get(`/carl/${key}`).callback(value);}};
}
const hb={counter:8,flags:5,mode:1};
const throttle={state:2,faults:0,applied_left:.75,applied_right:-.75};

test('only required topics are subscribed with one queued sample and 10 Hz rate',()=>{
  const s=setup(); s.session.setConnected(true);
  assert.deepEqual([...s.active.keys()],['/carl/heartbeat','/carl/throttle_status','/carl/encoders','/carl/steering_angle']);
  for(const sub of s.history){assert.equal(sub.options.queueLength,1);assert.equal(sub.options.throttleRateMs,100);}
  assert.equal(s.time.timerCount,1);
  s.session.setConnected(false); assert.equal(s.active.size,0); assert.equal(s.time.timerCount,0);
});

test('a burst replaces the latest readings without rendering each input',()=>{
  const s=setup(); let renders=0; s.session.subscribe(()=>renders++); s.session.setConnected(true);
  const before=renders;
  for(let i=0;i<10000;i++) s.receive('encoders',{rear_left_counts:i,rear_right_counts:-i});
  assert.equal(renders,before);
  s.time.advance(100);
  assert.equal(renders,before+1);
  assert.equal(s.session.getSnapshot().encoderLeft,9999);
  assert.equal(s.session.getSnapshot().encoderRight,-9999);
  assert.equal(s.session.getDiagnostics().retainedSamples,1);
  assert.equal(s.time.timerCount,1);
  s.time.advance(500); assert.equal(renders,before+1);
  s.session.setConnected(false);
});

test('freshness expires even if the socket remains open and sends no new values',()=>{
  const s=setup();s.session.setConnected(true);
  s.receive('heartbeat',hb);s.receive('throttle_status',throttle);
  s.receive('steering_angle',{status:1,valid:true,calibrated:true,sensor_voltage:2.5,angle_rad:Math.PI/6});
  s.time.advance(100);let data=s.session.getSnapshot();
  assert.equal(data.heartbeat,'online');assert.equal(data.appliedLeft,.75);assert.ok(Math.abs(data.steeringAngleDeg-30)<1e-8);
  s.time.advance(200);assert.equal(s.session.getSnapshot().steeringAngleDeg,null);
  s.time.advance(800);data=s.session.getSnapshot();
  assert.equal(data.heartbeat,'stale');assert.equal(data.appliedLeft,null);assert.equal(data.vehicleMode,null);
  s.session.setConnected(false);
});

test('hidden pages release subscriptions and display timers; resume requires new samples',()=>{
  const s=setup();s.session.setConnected(true);s.receive('heartbeat',hb);s.time.advance(100);
  const obsolete=s.active.get('/carl/heartbeat').callback;
  s.session.setVisible(false);
  assert.equal(s.active.size,0);assert.equal(s.time.timerCount,0);
  obsolete(hb);s.time.advance(60000);
  assert.equal(s.session.getSnapshot().heartbeatCounter,null);
  s.session.setVisible(true);assert.equal(s.active.size,4);assert.equal(s.time.timerCount,1);
  obsolete(hb);s.time.advance(100);assert.equal(s.session.getSnapshot().heartbeatCounter,null);
  s.receive('heartbeat',hb);s.time.advance(100);assert.equal(s.session.getSnapshot().heartbeatCounter,8);
  s.session.setConnected(false);
});

test('repeated disconnect/reconnect cannot retain callbacks, data or timers',()=>{
  const s=setup();
  for(let i=0;i<100;i++){
    s.session.setConnected(true);s.receive('heartbeat',hb);s.time.advance(100);
    const late=s.active.get('/carl/heartbeat').callback;
    s.session.setConnected(false);late(hb);
    assert.equal(s.session.getSnapshot().heartbeatCounter,null);
    assert.equal(s.time.timerCount,0);assert.equal(s.active.size,0);
  }
});

test('malformed or rejected topics clear locally and recover on the next valid sample',()=>{
  const s=setup();s.session.setConnected(true);s.receive('heartbeat',hb);s.receive('throttle_status',throttle);s.time.advance(100);
  s.active.get('/carl/throttle_status').options.onError(new Error('Unknown type'));s.time.advance(100);
  assert.equal(s.session.getSnapshot().appliedLeft,null);assert.equal(s.session.getSnapshot().heartbeatCounter,8);
  s.receive('throttle_status',throttle);s.time.advance(100);assert.equal(s.session.getSnapshot().appliedLeft,.75);
  s.receive('heartbeat',{...hb,flags:'bad'});s.time.advance(100);
  assert.equal(s.session.getSnapshot().heartbeat,'unknown');assert.equal(s.session.getSnapshot().vehicleMode,null);
  s.session.setConnected(false);
});

test('throwing observers and cleanup functions do not stop scheduling or other cleanup',()=>{
  const time=clock();let cleanups=0;
  const session=new TelemetrySession({subscribe(){return()=>{cleanups++;throw new Error('Bad cleanup');};}},time);
  let notifications=0;
  session.subscribe(()=>{throw new Error('Bad observer');});session.subscribe(()=>notifications++);
  session.setConnected(true);time.advance(100);assert.equal(time.timerCount,1);
  session.setConnected(false);
  assert.equal(cleanups,4);assert.equal(notifications,2);assert.equal(time.timerCount,0);
  assert.equal(session.getDiagnostics().cleanupErrors,4);
});

test('stored samples are independent scalar copies; oversized extra fields are discarded',()=>{
  const state={connected:true,samples:{}};
  const input={...hb,header:{frame_id:'x'.repeat(100000)},extra:[1,2,3]};
  assert.equal(ingest(state,'heartbeat',input,1),true);input.flags=2;
  assert.deepEqual(state.samples.heartbeat.value,hb);
  assert.equal(projectTelemetry(state,2).estopActive,false);
  assert.equal(Object.keys(state.samples.heartbeat.value).length,3);
});

test('e-stop mode wins over conflicting flags and never reports teleop ready',()=>{
  const state={connected:true,samples:{}};
  ingest(state,'heartbeat',{...hb,mode:2},1);
  assert.equal(projectTelemetry(state,1).estopActive,true);
  assert.equal(projectTelemetry(state,1).teleopReady,false);
});

test('invalid boundaries, time reversal and malformed inputs do not appear healthy',()=>{
  const state={connected:true,samples:{}};
  for(const value of [null,[],{}, {...hb,counter:256}, {...hb,mode:3}, {...hb,flags:NaN}]) {
    assert.equal(ingest(state,'heartbeat',value,1),false);
  }
  ingest(state,'heartbeat',hb,100);
  assert.equal(ingest(state,'heartbeat',hb,99),false);
  assert.equal(projectTelemetry(state,100).heartbeat,'unknown');
  assert.equal(ingest(state,'heartbeat',hb,Infinity),false);
  assert.equal(ingest(state,'heartbeat',hb,-1),false);
  assert.equal(ingest(state,'encoders',{rear_left_counts:2147483648,rear_right_counts:0},100),false);
});

test('reentrant visibility changes cannot start a second display timer',()=>{
  const s=setup();s.session.setConnected(true);
  let toggled=false;
  s.session.subscribe(()=>{
    if(!toggled){toggled=true;s.session.setVisible(false);s.session.setVisible(true);}
  });
  s.receive('heartbeat',hb);s.time.advance(100);
  assert.equal(s.time.timerCount,1);assert.equal(s.active.size,4);
  s.session.setConnected(false);assert.equal(s.time.timerCount,0);
});

test('a subscription failure does not disable other topics',()=>{
  const time=clock();let callbacks=0,cleanups=0;
  const session=new TelemetrySession({subscribe(topic){
    if(topic==='/carl/heartbeat')throw new Error('Bad registration');
    callbacks++;return()=>cleanups++;
  }},time);
  session.setConnected(true);assert.equal(callbacks,3);
  assert.equal(session.getDiagnostics().subscriptionErrors,1);
  session.setConnected(false);assert.equal(cleanups,3);assert.equal(time.timerCount,0);
});

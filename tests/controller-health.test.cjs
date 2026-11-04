'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const Header=require('../.test-build/components/dashboard/passenger/DashboardHeader.js').default;
const {ingest,projectTelemetry,setConnection}=require('../.test-build/lib/passenger/telemetry-store.js');
const throttle={state:2,faults:0,applied_left:.75,applied_right:-.75};
const steering={status:1,valid:true,calibrated:false,sensor_voltage:2.5,angle_rad:null};
const connected=()=>({connected:true,samples:{}});

test('healthy feedback lights both header indicators without steering calibration',()=>{
  const state=connected();
  ingest(state,'throttleStatus',throttle,100);ingest(state,'steeringAngle',steering,100);
  const data=projectTelemetry(state,100);
  assert.equal(data.throttleController,'online');assert.equal(data.steeringController,'online');
  assert.equal(data.steeringAngleDeg,null);
  const html=renderToStaticMarkup(React.createElement(Header,{...data,referenceClock:true,hour24:true}));
  for(const name of ['Throttle','Steering']){
    assert.match(html,new RegExp(`aria-label="${name} Teensy: Online"[^]*?health-dot online`));
  }
});

test('master heartbeat and throttle feedback cannot light the steering indicator',()=>{
  const state=connected();ingest(state,'heartbeat',{counter:1,flags:5,mode:1},100);
  let data=projectTelemetry(state,100);
  assert.equal(data.throttleController,'unknown');assert.equal(data.steeringController,'unknown');
  ingest(state,'throttleStatus',throttle,100);data=projectTelemetry(state,100);
  assert.equal(data.throttleController,'online');assert.equal(data.steeringController,'unknown');
});

test('throttle initialization, idle, driving, safe stop and e-stop have explicit health',()=>{
  for(const [stateValue,health] of ['unknown','online','online','fault','fault'].entries()){
    const state=connected();ingest(state,'throttleStatus',{...throttle,state:stateValue},100);
    assert.equal(projectTelemetry(state,100).throttleController,health);
  }
  for(const faults of [1,2,4,128]){
    const state=connected();ingest(state,'throttleStatus',{...throttle,faults},100);
    assert.equal(projectTelemetry(state,100).throttleController,'fault');
  }
});

test('steering timeout, invalid sensors and healthy recovery update the controller light',()=>{
  const state=connected();
  for(const status of [0,2,4,8,3]){
    ingest(state,'steeringAngle',{...steering,status,valid:false},100);
    assert.equal(projectTelemetry(state,100).steeringController,'fault');
  }
  ingest(state,'steeringAngle',{...steering,status:128,valid:false,sensor_voltage:null},101);
  assert.equal(projectTelemetry(state,101).steeringController,'stale');
  ingest(state,'steeringAngle',steering,102);
  assert.equal(projectTelemetry(state,102).steeringController,'online');
});

test('each controller expires on its own deadline while the socket remains connected',()=>{
  const state=connected();
  ingest(state,'throttleStatus',throttle,100);ingest(state,'steeringAngle',steering,100);
  assert.equal(projectTelemetry(state,350).steeringController,'online');
  assert.equal(projectTelemetry(state,351).steeringController,'stale');
  assert.equal(projectTelemetry(state,351).throttleController,'online');
  assert.equal(projectTelemetry(state,1100).throttleController,'online');
  assert.equal(projectTelemetry(state,1101).throttleController,'stale');
});

test('malformed feedback clears controller health and fresh feedback restores it',()=>{
  const state=connected();
  for(const [topic,value,key] of [
    ['throttleStatus',throttle,'throttleController'],['steeringAngle',steering,'steeringController'],
  ]){
    ingest(state,topic,value,100);assert.equal(projectTelemetry(state,100)[key],'online');
    ingest(state,topic,{},101);assert.equal(projectTelemetry(state,101)[key],'unknown');
    ingest(state,topic,value,102);assert.equal(projectTelemetry(state,102)[key],'online');
  }
});

test('disconnect and reconnect cannot reuse healthy controller readings',()=>{
  const state=connected();
  ingest(state,'throttleStatus',throttle,100);ingest(state,'steeringAngle',steering,100);
  for(const connected of [false,true]){
    setConnection(state,connected);const data=projectTelemetry(state,101);
    assert.equal(data.throttleController,'unknown');assert.equal(data.steeringController,'unknown');
  }
});

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { previewData, speedValue, batteryReading, batteryColor, sanitizeDashboardData } = require('../.test-build/lib/passenger/dashboard.js');
const { ingest, setConnection, projectTelemetry, sameDashboard } = require('../.test-build/lib/passenger/telemetry-store.js');
let count = 0;
function check(name, test) { test(); count++; console.log(`PASS ${name}`); }
const driving = previewData('driving');
check('Unavailable speed stays a dash', () => assert.equal(speedValue(previewData('reference'), 'km/h'), null));
check('Speed units convert correctly', () => { assert.equal(speedValue(driving, 'km/h'), '12.4'); assert.equal(speedValue(driving, 'mph'), '7.7'); });
check('Stale heartbeat suppresses speed', () => assert.equal(speedValue({...driving, heartbeat:'stale'}, 'km/h'), null));
check('Disconnect suppresses all cached readings', () => { const d = sanitizeDashboardData({...driving, connection:'offline'}); for (const key of ['speedKmh','batteryPercent','ambientC','encoderLeft','vehicleMode','estopActive','steeringAngleDeg']) assert.equal(d[key], null); assert.equal(d.steeringController, 'unknown'); });
check('NaN and infinite speeds are unavailable', () => { for (const speedKmh of [NaN, Infinity, -1]) assert.equal(speedValue({...driving,speedKmh}, 'km/h'), null); });
check('Zero and full battery are valid', () => { assert.equal(batteryReading(0),0); assert.equal(batteryReading(100),100); });
check('Invalid battery cannot appear as full or empty', () => { for (const value of [null, undefined, NaN, Infinity, -1, 101, '50']) assert.equal(batteryReading(value),null); });
check('Battery changes continuously from red through yellow to green', () => { assert.equal(batteryColor(0),'hsl(0 85% 48%)'); assert.equal(batteryColor(50),'hsl(60 85% 48%)'); assert.equal(batteryColor(100),'hsl(120 85% 48%)'); });
const state = {connected:false,samples:{}};
const hb = {counter:8,flags:5,mode:1};
const throttle = {state:2,faults:0,applied_left:.12,applied_right:.11};
check('Disconnected receiver rejects late callbacks', () => assert.equal(ingest(state,'heartbeat',hb,0),false));
setConnection(state,true);
check('Real heartbeat flags preserve mode and teleop status', () => { ingest(state,'heartbeat',hb,100); const d=projectTelemetry(state,100); assert.equal(d.heartbeat,'online'); assert.equal(d.vehicleMode,'Teleop'); assert.equal(d.teleopReady,true); assert.equal(d.estopActive,false); });
check('Heartbeat fault does not erase the estop indication', () => { ingest(state,'heartbeat',{...hb,flags:2,mode:2},101); const d=projectTelemetry(state,101); assert.equal(d.heartbeat,'fault'); assert.equal(d.estopActive,true); });
check('Throttle enum uses authoritative firmware mapping', () => { for (const [index,label] of ['Initializing','Idle','Driving','Safe stop','E-stop'].entries()) { ingest(state,'throttleStatus',{...throttle,state:index},102); assert.equal(projectTelemetry(state,102).throttle,label); } });
check('75% forward/reverse throttle passes through telemetry without clipping', () => {
  for (const sign of [-1, 1]) {
    assert.equal(ingest(state,'throttleStatus',{...throttle,applied_left:sign*.75,applied_right:sign*.75},103),true);
    const data=projectTelemetry(state,103);
    assert.equal(data.appliedLeft,sign*.75); assert.equal(data.appliedRight,sign*.75);
    assert.equal(data.throttle,'Driving');
  }
});
check('Heartbeat expiry does not require a socket disconnect', () => { ingest(state,'heartbeat',hb,1000); assert.equal(projectTelemetry(state,2000).heartbeat,'online'); assert.equal(projectTelemetry(state,2001).heartbeat,'stale'); });
check('Malformed heartbeat clears health instead of refreshing it', () => { ingest(state,'heartbeat',hb,2100); assert.equal(ingest(state,'heartbeat',{...hb,flags:'bad'},2101),false); assert.equal(projectTelemetry(state,2101).heartbeat,'unknown'); });
check('Invalid throttle enums are rejected', () => assert.equal(ingest(state,'throttleStatus',{...throttle,state:7},2200),false));
check('Reconnection never resurrects old samples', () => { ingest(state,'heartbeat',hb,2300); setConnection(state,false); setConnection(state,true); const d=projectTelemetry(state,2301); assert.equal(d.heartbeat,'unknown'); assert.equal(d.heartbeatCounter,null); });
check('Live adapter never invents battery, speed, ambient or controller health', () => { const d=projectTelemetry(state,2400); for(const key of ['speedKmh','batteryPercent','ambientC']) assert.equal(d[key],null); assert.equal(d.steeringController,'unknown'); assert.equal(d.throttleController,'unknown'); });
check('Unchanged snapshots skip React updates', () => assert.equal(sameDashboard(projectTelemetry(state,2400),projectTelemetry(state,2401)),true));
const steering={status:1, valid:true, calibrated:true, sensor_voltage:2.5,angle_rad:Math.PI/6};
check('Steering radians convert to degrees only when valid and calibrated',()=>{ingest(state,'steeringAngle',steering,2500);assert.ok(Math.abs(projectTelemetry(state,2500).steeringAngleDeg-30)<1e-8);});
check('Uncalibrated steering never invents an angle',()=>{ingest(state,'steeringAngle',{...steering,calibrated:false,angle_rad:NaN},2501);assert.equal(projectTelemetry(state,2501).steeringAngleDeg,null);});
check('Steering timeout sentinel clears angle',()=>{ingest(state,'steeringAngle',{status:128,valid:false,calibrated:true,angle_rad:null},2502);assert.equal(projectTelemetry(state,2502).steeringAngleDeg,null);});
check('Valid steering expires after 250ms',()=>{ingest(state,'steeringAngle',steering,2503);assert.equal(projectTelemetry(state,2754).steeringAngleDeg,null);});
check('Removed topics are not accepted at runtime',()=>{assert.equal(ingest(state,'imu',{},2800),false);assert.equal(ingest(state,'imuTemperature',{},2800),false);});
const start=performance.now();
for(let i=0;i<100000;i++) ingest(state,'steeringAngle',steering,3000+i);
const elapsed=performance.now()-start;
check('High-rate input retains only the latest sample per topic', () => { assert.equal(Object.keys(state.samples).length,1); assert.equal(state.samples.steeringAngle.receivedAt,102999); });
console.log(JSON.stringify({checks:count, receivePathSamples:100000, elapsedMs:Number(elapsed.toFixed(2)), retainedSamples:Object.keys(state.samples).length}));

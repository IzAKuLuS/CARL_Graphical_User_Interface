'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {ingest,projectTelemetry,setConnection}=require('../.test-build/lib/passenger/telemetry-store.js');
const View=require('../.test-build/components/dashboard/passenger/TelemetryView.js').default;
const motion=()=>({linear_acceleration:{x:1.25,y:-2.5,z:9.80665},angular_velocity:{x:.1,y:-.2,z:0},
  orientation_covariance:[-1,0,0,0,0,0,0,0,0]});
const diagnostic=(extra={})=>({data:JSON.stringify({schema:1,sensor:'MPU-9250',interface:'spi',
  ready:true,stage:'ready',error:'ok',error_count:5,...extra})});

test('IMU scalar snapshots preserve signed SI units and unavailable orientation',()=>{
  const s={connected:true,samples:{}};
  const m=motion(); assert.equal(ingest(s,'imu',m,0),true); m.linear_acceleration.x=999;
  ingest(s,'imuTemperature',{temperature:0},0); ingest(s,'imuDiagnostics',diagnostic(),0);
  const d=projectTelemetry(s,100);
  assert.equal(d.imuAccelX,1.25); assert.equal(d.imuAccelY,-2.5); assert.equal(d.imuGyroZ,0);
  assert.equal(d.imuTemperatureC,0); assert.equal(d.imuOrientationAvailable,false);
  assert.equal(d.imuSensor,'MPU-9250'); assert.equal(d.imuErrorCount,5);
  assert.equal(d.imuHealth,'online'); assert.equal(d.imuDiagnosticsHealth,'online');
  const html=renderToStaticMarkup(React.createElement(View,{data:d,speed:null,unit:'km/h'}));
  for(const text of ['1.250 m/s²','-2.500 m/s²','0.000 rad/s','0.000 °C','Not provided','MPU-9250']) assert.ok(html.includes(text),text);
  assert.ok(html.includes('Sensor die temperature, not ambient air'));
});

test('motion, temperature, and health expire independently and clear on disconnect',()=>{
  const s={connected:true,samples:{}};
  ingest(s,'imu',motion(),0); ingest(s,'imuTemperature',{temperature:35},0); ingest(s,'imuDiagnostics',diagnostic(),0);
  let d=projectTelemetry(s,501);
  assert.equal(d.imuAccelX,null); assert.equal(d.imuHealth,'stale'); assert.equal(d.imuTemperatureC,35);
  d=projectTelemetry(s,1001); assert.equal(d.imuTemperatureC,null); assert.equal(d.imuSensor,'MPU-9250');
  d=projectTelemetry(s,2501); assert.equal(d.imuSensor,null); assert.equal(d.imuDiagnosticsHealth,'stale');
  setConnection(s,false); d=projectTelemetry(s,2501); assert.equal(d.imuHealth,'offline');
  assert.equal(d.imuErrorCount,null); assert.equal(d.imuOrientationAvailable,null);
});

test('malformed IMU data is cleared without keeping a previous value fresh',()=>{
  const s={connected:true,samples:{}};
  for(const bad of [null,{}, {linear_acceleration:{x:null,y:0,z:0},angular_velocity:{x:0,y:0,z:0}},
    {...motion(),angular_velocity:{x:'0',y:0,z:0}}, {...motion(),angular_velocity:{x:Infinity,y:0,z:0}}]){
    ingest(s,'imu',motion(),0); assert.equal(ingest(s,'imu',bad,1),false);
    assert.equal(projectTelemetry(s,1).imuAccelX,null);
  }
  for(const data of ['bad','null','[]','{}',JSON.stringify({schema:2}), 'x'.repeat(4097)])
    assert.equal(ingest(s,'imuDiagnostics',{data},1),false);
  for(const temperature of [null,NaN,Infinity,'35',-274]) assert.equal(ingest(s,'imuTemperature',{temperature},1),false);
});

test('sensor errors mark diagnostics fault; historical counts do not prevent recovery',()=>{
  const s={connected:true,samples:{}};
  ingest(s,'imuDiagnostics',diagnostic({ready:false,stage:'retry_wait',error:'data_timeout'}),0);
  assert.equal(projectTelemetry(s,0).imuDiagnosticsHealth,'fault');
  ingest(s,'imuDiagnostics',diagnostic({error_count:6}),1);
  assert.equal(projectTelemetry(s,1).imuDiagnosticsHealth,'online');
});

test('high-rate IMU ingestion retains one scalar sample and no unbounded ROS payload',()=>{
  const s={connected:true,samples:{}};
  for(let i=0;i<10000;++i){const m=motion();m.linear_acceleration.x=i; m.extra='x'.repeat(1000); ingest(s,'imu',m,i);}
  assert.equal(Object.keys(s.samples).length,1); assert.equal(projectTelemetry(s,9999).imuAccelX,9999);
  assert.equal(Object.keys(s.samples.imu.value).length,7);
});

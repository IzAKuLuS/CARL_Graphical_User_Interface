'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const Header=require('../.test-build/components/dashboard/passenger/DashboardHeader.js').default;
const Drive=require('../.test-build/components/dashboard/passenger/DriveView.js').default;
const ErrorScreen=require('../.test-build/app/error.js').default;
const {createDashboardData}=require('../.test-build/lib/passenger/dashboard.js');
const render=(type,props)=>renderToStaticMarkup(React.createElement(type,props));

test('safe-stop and e-stop status never look healthy when fault bits are missing',()=>{
  for(const throttle of ['Safe stop','E-stop']){
    const html=render(Header,{...createDashboardData(),throttle,throttleFaults:0,hour24:true});
    assert.match(html,new RegExp(`Throttle status: ${throttle}[^]*?health-dot fault`));
  }
});

test('unknown live inputs remain unavailable in accessible header labels',()=>{
  const html=render(Header,{...createDashboardData(),hour24:true});
  assert.match(html,/Throttle status: Unavailable/);
  assert.match(html,/Ambient temperature: Sensor planned/);
  assert.match(html,/Battery: BMS planned/);
  assert.match(html,/class="clock" aria-label="—, —"/);
});

test('drive view retains offline, stale, unknown-speed and unit presentation',()=>{
  let html=render(Drive,{healthyConnection:false,heartbeat:'offline',speed:null,unit:'mph',sample:false});
  assert.match(html,/vehicle status unknown/);assert.match(html,/Speed unavailable/);assert.match(html,/>mph</);
  html=render(Drive,{healthyConnection:true,heartbeat:'stale',speed:null,unit:'km\/h',sample:false});
  assert.match(html,/Heartbeat stale/);
});

test('rendering failure fallback explicitly marks vehicle status unknown and offers recovery',()=>{
  const html=render(ErrorScreen,{error:new Error('Renderer failed'),reset:()=>{}});
  assert.match(html,/role="alert"/);assert.match(html,/Vehicle status is unknown/);assert.match(html,/Retry display/);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROSBridge, TRANSPORT_LIMITS } = require('../.test-build/lib/rosbridge.js');
const { validateRosbridgeUrl } = require('../.test-build/lib/rosConfig.js');
const { clock, FakeSocket } = require('./fakes.cjs');

function setup() {
  const time = clock(), sockets = [];
  const bridge = new ROSBridge({...time, random: () => .5, socket: url => {
    const socket = new FakeSocket(); socket.url = url; sockets.push(socket); return socket;
  }});
  async function open() {
    const pending = bridge.connect('ws://localhost:9192');
    sockets.at(-1).open();
    await pending;
    return sockets.at(-1);
  }
  return {bridge, time, sockets, open};
}

test('invalid and mixed-content addresses fail before opening a socket', async () => {
  const s = setup();
  for (const url of ['http://localhost', 'ws://user:secret@localhost', 'ws://localhost/#fragment', 'invalid']) {
    await assert.rejects(s.bridge.connect(url));
  }
  assert.equal(s.sockets.length, 0);
  assert.equal(s.time.timerCount, 0);
  global.window = {location: {protocol: 'https:'}};
  try { assert.throws(() => validateRosbridgeUrl('ws://localhost')); }
  finally { delete global.window; }
});

test('concurrent connect shares one attempt; explicit disconnect never reconnects', async () => {
  const s = setup();
  const a = s.bridge.connect('ws://localhost:9192');
  const b = s.bridge.connect('ws://localhost:9192');
  assert.equal(a, b);
  assert.equal(s.sockets.length, 1);
  s.sockets[0].open(); await a;
  s.bridge.disconnect();
  s.time.advance(120000);
  assert.equal(s.sockets.length, 1);
  assert.equal(s.time.timerCount, 0);
  assert.equal(s.bridge.isConnected(), false);
});

test('constructor failures recover without poisoning the next attempt', async () => {
  const time = clock(); let attempts = 0, socket;
  const bridge = new ROSBridge({...time, random: () => .5, socket: () => {
    if (++attempts === 1) throw new Error('Constructor failed');
    return socket = new FakeSocket();
  }});
  await assert.rejects(bridge.connect('ws://localhost'), /Unable to open/);
  time.advance(1000); socket.open();
  assert.equal(bridge.isConnected(), true);
  bridge.disconnect();
  assert.equal(time.timerCount, 0);
});

test('closing before open rejects the attempt; handshakes have a deadline', async () => {
  const s = setup();
  const first = s.bridge.connect('ws://localhost');
  const rejected = assert.rejects(first, /closed/);
  s.sockets[0].close(); await rejected;
  s.time.advance(1000);
  s.time.advance(TRANSPORT_LIMITS.connectTimeoutMs);
  assert.equal(s.bridge.getSnapshot().status, 'reconnecting');
  s.bridge.disconnect();
  assert.equal(s.time.timerCount, 0);
});

test('a stale socket cannot change state, deliver data or resolve a new service', async () => {
  const s = setup(), values = [];
  const old = await s.open();
  s.bridge.subscribe('/topic','test/Message', value => values.push(value));
  const late = {open: old.onopen, close: old.onclose, message: old.onmessage, error: old.onerror};
  const pending = s.bridge.connect('ws://different-host:9192');
  const current = s.sockets.at(-1); current.open(); await pending;
  const service = s.bridge.callService('/test','test/Service',{});
  const id = current.sent.at(-1).id;
  late.open(); late.close(); late.error();
  late.message({data: JSON.stringify({op:'publish',topic:'/topic',msg:{old:true}})});
  late.message({data: JSON.stringify({op:'service_response',id,result:true,values:{old:true}})});
  assert.equal(values.length,0);
  assert.equal(s.bridge.getDiagnostics().pendingServices,1);
  current.receive({op:'service_response',id,result:true,values:{current:true}});
  assert.deepEqual(await service,{current:true});
  assert.equal(s.bridge.isConnected(),true);
  s.bridge.disconnect();
});

test('errors without close events and silent half-open links reconnect', async () => {
  const s = setup(); let socket = await s.open();
  socket.onerror();
  assert.equal(s.bridge.isConnected(),false);
  assert.equal(socket.closed,1);
  s.time.advance(1000); socket = s.sockets.at(-1); socket.open();
  s.time.advance(TRANSPORT_LIMITS.idleTimeoutMs);
  assert.equal(s.bridge.getSnapshot().status,'reconnecting');
  assert.match(s.bridge.getSnapshot().error,/stopped responding/);
  s.bridge.disconnect();
});

test('valid replies keep quiet telemetry connections alive without per-packet timers', async () => {
  const s = setup(), socket = await s.open();
  for (let i=0; i<20; i++) {
    s.time.advance(5000);
    socket.receive({op:'service_response',id:'ignored',values:{topics:[]},result:true});
    assert.equal(s.bridge.isConnected(),true);
    assert.equal(s.time.timerCount,1);
  }
  s.bridge.disconnect();
});

test('subscription sharing, queue limits, reconnect restoration and obsolete cleanup', async () => {
  const s = setup(), values = [];
  const a = s.bridge.subscribe('/topic','test/Message',v => values.push(v));
  const b = s.bridge.subscribe('/topic','test/Message',v => values.push(v));
  let socket = await s.open();
  assert.equal(socket.sent.length,1);
  assert.deepEqual(socket.sent[0],{op:'subscribe',id:'subscribe:/topic',topic:'/topic',type:'test/Message',throttle_rate:100,queue_length:1,compression:'none'});
  socket.receive({op:'publish',topic:'/topic',msg:{value:1}});
  assert.equal(values.length,2);
  a(); a(); assert.equal(socket.sent.length,1);
  socket.close(); s.time.advance(1000); socket=s.sockets.at(-1); socket.open();
  assert.equal(socket.sent.length,1);
  b(); assert.equal(socket.sent.at(-1).op,'unsubscribe');
  s.bridge.disconnect();
  const remove = s.bridge.subscribe('/topic','test/Message',()=>{});
  a(); b(); assert.equal(s.bridge.getDiagnostics().subscriptions,1);
  remove(); assert.equal(s.bridge.getDiagnostics().subscriptions,0);
});

test('conflicting or invalid subscriptions fail explicitly', () => {
  const s=setup();
  s.bridge.subscribe('/topic','test/Message',()=>{});
  assert.throws(()=>s.bridge.subscribe('/topic','other/Message',()=>{}),/Conflicting/);
  assert.throws(()=>s.bridge.subscribe('relative','test/Message',()=>{}),/absolute/);
  assert.throws(()=>s.bridge.subscribe('/bad','test/Message',()=>{},{queueLength:0}));
  s.bridge.disconnect();
});

test('malformed envelopes and callback failures cannot break other consumers', async () => {
  const s=setup(), socket=await s.open(), values=[];
  s.bridge.subscribe('/topic','test/Message',()=>{throw new Error('Consumer failed');});
  s.bridge.subscribe('/topic','test/Message',v=>values.push(v));
  for (const data of ['null','[]','{',JSON.stringify({}),new ArrayBuffer(1),'x'.repeat(TRANSPORT_LIMITS.maxMessageChars+1)]) {
    socket.onmessage({data});
  }
  socket.receive({op:'publish',topic:'/topic',msg:{value:3}});
  assert.deepEqual(values,[{value:3}]);
  assert.equal(s.bridge.getDiagnostics().invalidMessages,6);
  assert.equal(s.bridge.getDiagnostics().callbackErrors,1);
  socket.receive({op:'publish',topic:'/topic',msg:{data:'AQID'}});
  assert.deepEqual([...values.at(-1).data],[1,2,3]);
  s.bridge.disconnect();
});

test('subscription rejection is surfaced and invalidates only its consumer', async () => {
  const s=setup(), socket=await s.open(), failures=[];
  s.bridge.subscribe('/topic','test/Message',()=>{},{onError:e=>failures.push(e.message)});
  socket.receive({op:'status',level:'error',id:'subscribe:/topic',msg:'Unknown message type'});
  assert.equal(s.bridge.isConnected(),true);
  assert.match(s.bridge.getSnapshot().error,/Unknown message type/);
  assert.equal(failures.length,1);
  s.bridge.disconnect();
});

test('services resolve, fail, time out and reject promptly on disconnect without leaks', async () => {
  const s=setup(), socket=await s.open();
  for (const failed of [false,true]) {
    const call=s.bridge.callService('/test','test/Service',{});
    const result=failed ? assert.rejects(call,/failed/) : call;
    socket.receive({op:'service_response',id:socket.sent.at(-1).id,result:!failed,values:{answer:42}});
    if (!failed) assert.deepEqual(await result,{answer:42}); else await result;
  }
  let call=s.bridge.callService('/test','test/Service',{},500);
  let rejected=assert.rejects(call,/timed out/); s.time.advance(500); await rejected;
  call=s.bridge.callService('/test','test/Service',{});
  rejected=assert.rejects(call,/disconnected/); s.bridge.disconnect(); await rejected;
  assert.equal(s.bridge.getDiagnostics().pendingServices,0);
  assert.equal(s.time.timerCount,0);
});

test('service bounds, server errors and blocked sends release all resources', async () => {
  const s=setup(), socket=await s.open();
  const results=[];
  for(let i=0;i<TRANSPORT_LIMITS.maxPendingServices;i++) {
    results.push(assert.rejects(s.bridge.callService('/test','test/Service',{})));
  }
  await assert.rejects(s.bridge.callService('/overflow','test/Service',{}),/Too many/);
  s.bridge.disconnect(); await Promise.all(results);
  assert.equal(s.time.timerCount,0);
  const next=await s.open();
  const call=s.bridge.callService('/test','test/Service',{});
  const rejected=assert.rejects(call,/denied/);
  next.receive({op:'status',id:next.sent.at(-1).id,level:'error',msg:'denied'}); await rejected;
  next.bufferedAmount=TRANSPORT_LIMITS.maxBufferedBytes+1;
  assert.equal(s.bridge.publish('/topic','test/Message',{}),false);
  assert.equal(s.bridge.isConnected(),false);
  s.bridge.disconnect();
  assert.equal(s.time.timerCount,0);
});

test('last-owner cleanup is idempotent and a later mount starts cleanly', async () => {
  const s=setup(), first=s.bridge.retain(), second=s.bridge.retain();
  await s.open(); first(); first(); assert.equal(s.bridge.isConnected(),true);
  second(); assert.equal(s.bridge.isConnected(),false); assert.equal(s.time.timerCount,0);
  const release=s.bridge.retain(); await s.open(); release();
  assert.equal(s.time.timerCount,0);
});

test('backoff stays capped through a prolonged outage and stops on manual disconnect', async () => {
  const s=setup(); const initial=s.bridge.connect('ws://localhost');
  const rejected=assert.rejects(initial); s.sockets[0].close(); await rejected;
  for(let i=0;i<100;i++) {
    s.time.advance(30000);
    s.sockets.at(-1).onerror?.();
    assert.equal(s.time.timerCount,1);
    assert.equal(s.bridge.getDiagnostics().pendingServices,0);
  }
  s.bridge.disconnect(); assert.equal(s.time.timerCount,0);
});

test('observers can retire a connection during open without leaking timers or promises',async()=>{
  const s=setup();
  s.bridge.subscribeConnection(()=>{
    if(s.bridge.isConnected())s.bridge.disconnect();
  });
  const pending=s.bridge.connect('ws://localhost');
  const rejected=assert.rejects(pending,/superseded/);
  s.sockets[0].open();await rejected;
  assert.equal(s.time.timerCount,0);
  assert.equal(s.bridge.getSnapshot().status,'disconnected');
});

test('publish validates topic names and never queues messages for reconnect',async()=>{
  const s=setup();
  assert.throws(()=>s.bridge.publish('relative','test/Message',{}),/absolute/);
  assert.equal(s.bridge.publish('/topic','test/Message',{}),false);
  const socket=await s.open();
  assert.equal(socket.sent.length,0);
  assert.equal(s.bridge.publish('/topic','test/Message',{value:1}),true);
  assert.deepEqual(socket.sent.at(-1),{op:'publish',topic:'/topic',type:'test/Message',msg:{value:1}});
  s.bridge.disconnect();
});

test('cancelling during the connecting notification does not construct an orphan socket',async()=>{
  const s=setup();
  s.bridge.subscribeConnection(()=>{
    if(s.bridge.getSnapshot().status==='connecting')s.bridge.disconnect();
  });
  await assert.rejects(s.bridge.connect('ws://localhost'),/disconnected/);
  assert.equal(s.sockets.length,0);assert.equal(s.time.timerCount,0);
});

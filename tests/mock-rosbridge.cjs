'use strict';
// Local integration fixture only; never opens a vehicle transport.
const { WebSocketServer } = require('next/dist/compiled/ws');
const TOPICS = ['/carl/heartbeat','/carl/throttle_status','/carl/encoders','/carl/steering_angle','/carl/imu','/carl/imu/temperature','/carl/imu/diagnostics'];
const MODES = new Set(['live','pause','malformed','estop','silent','steering','steering-uncalibrated','steering-fault','subscription-error','imu-pause','imu-malformed','imu-fault','imu-recovered']);

function startFixture({port=9192}={}) {
  const server = new WebSocketServer({host:'127.0.0.1',port});
  const clients = new Map();
  let mode='live';
  const stats={connections:0,messages:0,commands:0,subscribeRequests:0,serviceCalls:0};
  server.on('connection',socket=>{
    stats.connections++;
    const subscriptions=new Map();
    clients.set(socket,subscriptions);
    let step=0;
    socket.on('message',buffer=>{
      let message;
      try { message=JSON.parse(buffer.toString()); } catch { return; }
      if(message.op==='subscribe') {
        stats.subscribeRequests++;
        subscriptions.set(message.topic,{rate:message.throttle_rate??0,last:0,id:message.id});
        if(mode==='subscription-error') socket.send(JSON.stringify({op:'status',level:'error',id:message.id,msg:'Unknown message type'}));
      }
      if(message.op==='unsubscribe') subscriptions.delete(message.topic);
      if(message.op==='call_service') {
        stats.serviceCalls++;
        if(mode!=='silent') socket.send(JSON.stringify({op:'service_response',id:message.id,result:true,values:{topics:TOPICS}}));
      }
      if(message.op==='publish') stats.commands++;
    });
    const timer=setInterval(()=>{
      if(['pause','silent','subscription-error'].includes(mode)||socket.readyState!==1) return;
      step++;
      const messages={
        '/carl/heartbeat':{counter:step%256,flags:mode==='estop'?2:5,mode:mode==='estop'?2:1},
        '/carl/throttle_status':mode==='malformed'?{state:99}:{state:mode==='estop'?4:2,faults:mode==='estop'?2:0,applied_left:mode==='estop'?0:.75,applied_right:mode==='estop'?0:-.75},
        '/carl/steering_angle':mode==='steering'?{status:1,valid:true,calibrated:true,sensor_voltage:2.5,angle_rad:Math.PI/6}
          :mode==='steering-uncalibrated'?{status:1,valid:true,calibrated:false,sensor_voltage:2.5,angle_rad:null}
          :mode==='steering-fault'?{status:2,valid:false,calibrated:false,sensor_voltage:0,angle_rad:null}
          :{status:128,valid:false,calibrated:false,sensor_voltage:null,angle_rad:null},
        '/carl/imu':{linear_acceleration:{x:mode==='imu-malformed'?null:1.25,y:-2.5,z:9.80665},
          angular_velocity:{x:.1,y:-.2,z:0},orientation:{x:0,y:0,z:0,w:0},orientation_covariance:[-1,0,0,0,0,0,0,0,0]},
        '/carl/imu/temperature':{temperature:mode==='imu-malformed'?null:34.125,variance:0},
        '/carl/imu/diagnostics':{data:mode==='imu-malformed'?'bad json':JSON.stringify({schema:1,sensor:'MPU-9250',
          interface:'spi',ready:mode!=='imu-fault',stage:mode==='imu-fault'?'retry_wait':'ready',
          error:mode==='imu-fault'?'data_timeout':'ok',error_count:['imu-fault','imu-recovered'].includes(mode)?5:0})},
        '/carl/encoders':{rear_left_counts:12480+step*4,rear_right_counts:12464+step*4},
      };
      const now=Date.now();
      for(const [topic,sub] of subscriptions) {
        if(mode==='imu-pause' && topic.startsWith('/carl/imu')) continue;
        if(now-sub.last<sub.rate || !messages[topic]) continue;
        sub.last=now;
        stats.messages++;
        socket.send(JSON.stringify({op:'publish',topic,msg:messages[topic]}));
      }
    },20);
    socket.on('close',()=>{clearInterval(timer);clients.delete(socket);});
  });
  return {
    server,
    setMode(next) {if(!MODES.has(next)) throw new Error(`Invalid fixture mode: ${next}`);mode=next;},
    disconnectClients(){for(const socket of clients.keys()) socket.close();},
    stats(){return {...stats,activeConnections:clients.size,subscriptions:[...clients.values()].reduce((n,s)=>n+s.size,0)};},
    async close(){for(const socket of clients.keys()) socket.terminate();await new Promise(resolve=>server.close(resolve));},
  };
}
module.exports={startFixture};

if(require.main===module) {
  const fixture=startFixture();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',value=>{
    const mode=value.trim();
    if(mode==='disconnect')fixture.disconnectClients();
    else if(MODES.has(mode))fixture.setMode(mode);
    console.log('Fixture:',fixture.stats());
  });
  console.log(`LOCAL SAMPLE ROS FIXTURE ws://127.0.0.1:9192 — ${[...MODES,'disconnect'].join(' / ')}`);
}

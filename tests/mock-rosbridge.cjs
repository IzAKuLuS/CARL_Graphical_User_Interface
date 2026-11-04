// Local integration fixture only. This is not a real ROS server or a vehicle connection.
const { WebSocketServer } = require('next/dist/compiled/ws');
const server = new WebSocketServer({host:'127.0.0.1',port:9192});
const topics = ['/carl/heartbeat','/carl/throttle_status','/carl/encoders','/carl/steering_angle'];
let mode = 'live';
const clients = new Set();
server.on('connection', socket => {
  clients.add(socket);
  const subscriptions = new Set();
  let step=0;
  socket.on('message', buffer => {
    const message=JSON.parse(buffer.toString());
    if(message.op==='subscribe') subscriptions.add(message.topic);
    if(message.op==='unsubscribe') subscriptions.delete(message.topic);
    if(message.op==='call_service') socket.send(JSON.stringify({op:'service_response',id:message.id,result:true,values:{topics}}));
    if(message.op==='publish') console.error('UNEXPECTED VEHICLE COMMAND',message.topic);
  });
  const timer=setInterval(()=>{
    if(mode==='pause' || socket.readyState!==1)return;
    step++;
    const stamp={header:{stamp:{sec:0,nanosec:0},frame_id:'base_link'}};
    const messages={
      '/carl/heartbeat':{...stamp,counter:step%256,flags:5,mode:1},
      '/carl/throttle_status':{...stamp,state:Math.floor(step/40)%2 ? 1 : 2,faults:0,applied_left:Math.floor(step/40)%2 ? 0 : .12,applied_right:Math.floor(step/40)%2 ? 0 : .11},
      '/carl/steering_angle':{...stamp,status:128,valid:false,calibrated:false,sensor_voltage:null,angle_rad:null},
      '/carl/encoders':{...stamp,rear_left_counts:12480+step*4,rear_right_counts:12464+step*4}
    };
    for(const topic of subscriptions){
      let msg=messages[topic];
      if(mode==='estop' && topic==='/carl/heartbeat') msg={...msg,flags:2,mode:2};
      if(mode==='estop' && topic==='/carl/throttle_status') msg={...msg,state:4,faults:2,applied_left:0,applied_right:0};
      if(mode==='malformed' && topic==='/carl/throttle_status') msg={state:99};
      socket.send(JSON.stringify({op:'publish',topic,msg}));
    }
  },50);
  socket.on('close',()=>{clearInterval(timer);clients.delete(socket);});
});
// Test controls through the terminal, never exposed in the passenger interface.
process.stdin.setEncoding('utf8');
process.stdin.on('data', value=>{
  const next=value.trim();
  if(['live','pause','malformed','estop'].includes(next))mode=next;
  if(next==='disconnect')for(const client of clients)client.close();
  console.log('Fixture mode:',mode);
});
console.log('LOCAL SAMPLE ROS FIXTURE ws://127.0.0.1:9192 — input: live / pause / malformed / estop / disconnect');

'use strict';

function clock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, {callback, at: now + delay});
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    get timerCount() { return timers.size; },
    advance(ms) {
      const finish = now + ms;
      let iterations = 0;
      while (true) {
        const due = [...timers].filter(([, value]) => value.at <= finish).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        if (++iterations > 10000) throw new Error('Timer loop failed to make progress');
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
      }
      now = finish;
    },
  };
}

class FakeSocket {
  readyState = 0;
  bufferedAmount = 0;
  sent = [];
  closed = 0;
  send(message) {
    if (this.failSend || this.readyState !== 1) throw new Error('Broken socket');
    this.sent.push(JSON.parse(message));
  }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.closed++; this.readyState = 3; this.onclose?.(); }
  receive(message) { this.onmessage?.({data: JSON.stringify(message)}); }
}
module.exports = { clock, FakeSocket };

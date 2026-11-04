'use strict';
const {readdirSync}=require('node:fs');

require('./data.cjs');
require('./reliability.cjs');
// Run in one process: no test-worker startup overhead and shared fake APIs stay local.
for(const file of readdirSync(__dirname).filter(name=>name.endsWith('.test.cjs')).sort()) {
  require(`./${file}`);
}

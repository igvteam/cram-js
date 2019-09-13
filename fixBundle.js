const fs = require('fs');

const bundlePath = './dist/cram-bundle.js';
let ping = fs.readFileSync(bundlePath, 'utf-8');
ping = ping.replace(/eval/g, 'eval2');
ping = `var eval2=eval\n${ping}\nexport default gmodCram\n`;

fs.writeFileSync(bundlePath, ping,  'utf-8');


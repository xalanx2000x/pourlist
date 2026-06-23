// Extract the actual LATE_NIGHT classifyHHType regex from the file and test it
const fs = require('fs');
const code = fs.readFileSync('/Users/livingroom/.openclaw/workspace/pourlist/src/lib/parse-hh.ts', 'utf8');

// Find the LATE_NIGHT regex test line
const ln174match = code.match(/if \(\/([^/]+)\/\\.test\(lower\)/);
if (ln174match) {
  const pattern = ln174match[1].replace(/\\b/g, '\\\\b');
  console.log('LATE_NIGHT classifyHHType regex pattern:');
  console.log(pattern);
  console.log();
  
  const regex = new RegExp(pattern.replace(/\\\//g, '/').replace(/\\\\/g, '\\'), 'i');
  console.log('Test inputs against this regex:');
  const tests = ['after 9pm', 'after 10pm', 'after midnight', 'after 12', 'after 9', 'after 12am'];
  for (const t of tests) {
    console.log(' ', t, '→', regex.test(t));
  }
}

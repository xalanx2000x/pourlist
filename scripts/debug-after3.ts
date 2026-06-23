// Call the actual classifyHHType from the parse-hh module
import {parseOneClause} from '../src/lib/parse-hh.ts';

// Manually replicate the early return path
function test() {
  const inputs = ['after 9pm', 'after 10pm', 'after midnight', 'after 12', 'after 9', 'after 12am'];
  for (const t of inputs) {
    // We can't call classifyHHType directly (not exported), but we can
    // see what parseOneClause returns after the early return
    // Since "after 9pm" -> null, it means classifyHHType returned type=typical
    const r = parseOneClause(t);
    console.log(t, '→', JSON.stringify(r), r === null ? '(null — type was typical, no match)' : '');
  }
}
test();

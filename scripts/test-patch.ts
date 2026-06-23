import {parseOneClause, classifyHHType, normalizeText} from '../src/lib/parse-hh.ts';
const t = 'before 2am';
const norm = normalizeText(t);
const cls = classifyHHType(t);
const result = parseOneClause(t);
console.log('input:', t);
console.log('normalizeText:', JSON.stringify(norm));
console.log('classifyHHType:', JSON.stringify(cls));
console.log('parseOneClause:', JSON.stringify(result));

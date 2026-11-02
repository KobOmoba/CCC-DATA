// Field accuracy of results/<label> against truth.json. node score.mjs <label>
import { readFileSync } from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname, label = process.argv[2];
const truth = JSON.parse(readFileSync(HERE + 'truth.json'));
const FIELDS = ['fullName', 'gender', 'maritalStatus', 'address', 'phone', 'email', 'rank', 'occupation', 'dobDay', 'dobMonth', 'dobYear',
  'anointDay', 'anointMonth', 'anointYear', 'nokName', 'nokAddress', 'nokPhone'];
const norm = (k, v) => v == null ? '' : /phone/i.test(k) ? String(v).replace(/\D/g, '') : String(v).toLowerCase().replace(/[^a-z0-9@]/g, '');
let all = 0, allOk = 0; const perField = {}; const misses = [];
for (const [file, people] of Object.entries(truth)) {
  const got = JSON.parse(readFileSync(`${HERE}results/${label}/${file}.json`)).people || [];
  let n = 0, ok = 0;
  for (const p of people) {
    const g = got.find(x => norm('n', x.fullName) === norm('n', p.fullName)) || got.find(x => norm('n', x.fullName).includes(norm('n', p.fullName.split(' ').pop()))) || {};
    for (const k of FIELDS) {
      const good = norm(k, g[k]) === norm(k, p[k]);
      n++; ok += good; (perField[k] ||= [0, 0])[0] += good; perField[k][1]++;
      if (!good) misses.push(`${file} | ${p.fullName} | ${k}: want "${p[k] ?? ''}" got "${g[k] ?? ''}"`);
    }
  }
  console.log(`${file}: people found ${got.length}/${people.length}, fields ${ok}/${n} = ${(100 * ok / n).toFixed(1)}%`);
  all += n; allOk += ok;
}
console.log(`OVERALL: ${allOk}/${all} = ${(100 * allOk / all).toFixed(1)}%`);
console.log('Per field:', Object.entries(perField).map(([k, [a, b]]) => `${k} ${a}/${b}`).join(', '));
console.log('Misses:\n' + (misses.join('\n') || 'none'));

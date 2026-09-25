import { test } from 'vitest';
test('x', () => { const b=[]; while(true) b.push(new Array(1e6).fill('x')); });
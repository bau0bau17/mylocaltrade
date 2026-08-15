/**
 * Regression guard: the Expo Router route tree (app/) must NEVER contain
 * test files. Metro treats everything under app/ as application code and
 * expo-router registers files as routes, so a `.test.tsx` there gets bundled
 * into the running app — and its test-only imports (@testing-library/...)
 * crash Metro with "Unable to resolve module" on the device.
 *
 * Test files belong outside app/ (e.g. __tests__/ or hooks/__tests__/).
 */

import * as fs from 'fs';
import * as path from 'path';

const APP_DIR = path.resolve(__dirname, '..', 'app');

const FORBIDDEN = /(\.test\.[jt]sx?|\.spec\.[jt]sx?)$/;

function collectOffenders(dir: string, offenders: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') {
        offenders.push(path.relative(APP_DIR, full) + path.sep);
        continue;
      }
      collectOffenders(full, offenders);
    } else if (FORBIDDEN.test(entry.name)) {
      offenders.push(path.relative(APP_DIR, full));
    }
  }
}

describe('expo-router route tree hygiene', () => {
  it('contains no test/spec files or __tests__/__mocks__ dirs under app/', () => {
    const offenders: string[] = [];
    collectOffenders(APP_DIR, offenders);
    expect(offenders).toEqual([]);
  });
});

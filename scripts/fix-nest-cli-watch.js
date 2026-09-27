/**
 * Fixes `nest start --watch` crashing with
 * "TypeError: Cannot destructure property `paths` of 'undefined' or 'null'".
 *
 * When tsconfig.json is re-read but nothing in the program changed (the file
 * is rewritten with the same contents, or Windows reports a change in its
 * folder), TypeScript's watch mode reuses the previous program by calling
 * createProgram(undefined, undefined, ...). @nestjs/cli 7.6.0 (the last 7.x;
 * 8+ needs a newer npm than Node 12.1.0 ships) passes those options straight
 * to its tsconfig-paths hook, which destructures them and throws. The watcher
 * dies, and the app it started keeps running on its port with stale code.
 *
 * This makes the hook use the reused program's own options in that case.
 *
 * Idempotent: safe to run on every install. Runs from `postinstall`.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../node_modules/@nestjs/cli/lib/compiler/watch-compiler.js');
const UNGUARDED = 'tsconfigPathsBeforeHookFactory(options);';
const GUARDED = 'tsconfigPathsBeforeHookFactory(options || (oldProgram ? oldProgram.getCompilerOptions() : {}));';

if (!fs.existsSync(file)) {
  console.log('@nestjs/cli not installed; nothing to fix');
  process.exit(0);
}

const source = fs.readFileSync(file, 'utf8');

if (source.indexOf(GUARDED) !== -1) {
  console.log('@nestjs/cli watch compiler already fixed');
} else if (source.indexOf(UNGUARDED) === -1) {
  // A different version without this code: nothing to patch, but say so.
  console.warn('@nestjs/cli watch compiler: expected code not found; left unchanged');
} else {
  fs.writeFileSync(file, source.split(UNGUARDED).join(GUARDED));
  console.log('Fixed @nestjs/cli watch mode crash on tsconfig reload');
}

// Opt-in, local benchmark only. Never loaded by npm start or instrumentation.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node --require preloads use CommonJS.
const { getHeapStatistics } = require('node:v8');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- local preload transport.
const { appendFileSync } = require('node:fs');

const outputFile = process.env.MON_CAHIER_LOCAL_MEMORY_AUDIT_FILE;
if (process.env.MON_CAHIER_LOCAL_MEMORY_AUDIT === '1' && (process.send || outputFile)) {
  const sample = () => {
    if (!outputFile && !process.connected) return;
    const row = {
      type: 'memory',
      at: Date.now(),
      pid: process.pid,
      argv: process.argv,
      execArgv: process.execArgv,
      uptime: process.uptime(),
      ...process.memoryUsage(),
      maxRssKiB: process.resourceUsage().maxRSS,
      cpu: process.cpuUsage(),
      heapLimit: getHeapStatistics().heap_size_limit,
      typescriptLoaded: Object.keys(require.cache).some(path => path.includes('/typescript/lib/typescript.js')),
      swcLoaded: Object.keys(require.cache).some(path => /next-swc.*\.node$/.test(path)),
      webpackLoaded: Object.keys(require.cache).some(path => path.endsWith('/compiled/webpack/bundle5.js')),
    };
    if (outputFile) appendFileSync(outputFile, JSON.stringify(row) + '\n');
    else process.send(row);
  };
  sample();
  setInterval(sample, 500).unref();
}

// Opt-in, local benchmark only. Never loaded by npm start or instrumentation.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node --require preloads use CommonJS.
const { getHeapStatistics } = require('node:v8');

if (process.env.MON_CAHIER_LOCAL_MEMORY_AUDIT === '1' && process.send) {
  const sample = () => {
    if (!process.connected) return;
    process.send({
      type: 'memory',
      at: Date.now(),
      pid: process.pid,
      uptime: process.uptime(),
      ...process.memoryUsage(),
      maxRssKiB: process.resourceUsage().maxRSS,
      cpu: process.cpuUsage(),
      heapLimit: getHeapStatistics().heap_size_limit,
      typescriptLoaded: Object.keys(require.cache).some(path => path.includes('/typescript/lib/typescript.js')),
      swcLoaded: Object.keys(require.cache).some(path => /next-swc.*\.node$/.test(path)),
      webpackLoaded: Object.keys(require.cache).some(path => path.endsWith('/compiled/webpack/bundle5.js')),
    });
  };
  sample();
  setInterval(sample, 500).unref();
}

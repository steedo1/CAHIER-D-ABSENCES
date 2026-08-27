const url = 'https://nnxgxxktjvgnnbcedmvv.supabase.co/functions/v1/csca-run-14b56f8f5fbbe674425f8a69';
const res = await fetch(url, { cache: 'no-store' });
const text = await res.text();
console.log('[CSCA_SYNC_RESULT]', text);
if (!res.ok) {
  console.error('[CSCA_SYNC_FAILED]', res.status, res.statusText);
  process.exit(1);
}

import http from 'http';
import app from '../app.js';

function request(hostname, port, path = '/health') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

const server = app.listen(0, async () => {
  const { port } = server.address();
  try {
    const res = await request('127.0.0.1', port, '/health');
    if (res.status !== 200) {
      console.error('Health check status != 200:', res.status);
      process.exitCode = 1;
    } else if (!String(res.body || '').includes('ok')) {
      console.error('Health check body missing ok:', res.body);
      process.exitCode = 1;
    } else {
      console.log('Health OK');
    }
  } catch (e) {
    console.error('Health request failed:', e);
    process.exitCode = 1;
  } finally {
    server.close(() => process.exit());
  }
});


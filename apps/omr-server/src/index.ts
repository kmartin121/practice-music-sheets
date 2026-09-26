import { createApp, HOST, PORT } from './app.js';

const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`OMR sidecar listening on http://${HOST}:${PORT}`);
});

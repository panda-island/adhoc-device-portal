import { createApp } from './app.mjs';
const app = await createApp();
const port = Number(process.env.PORT || 3000);
app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Portal: http://localhost:${port} | Apple: ${process.env.APPLE_MODE || 'mock'}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.server.close(() => { app.close(); process.exit(0); }));

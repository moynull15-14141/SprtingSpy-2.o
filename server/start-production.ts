// Set before importing dotenv/auth/cookie modules; never silently launch Vite.
(process.env as Record<string, string>).NODE_ENV = 'production';
await import('../server');

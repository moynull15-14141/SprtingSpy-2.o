// Set before importing dotenv/auth/cookie modules; never silently launch Vite.
process.env.NODE_ENV = 'production';
await import('../server');

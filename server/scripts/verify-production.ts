// Reuse the complete account/security/integrity suite over a local HTTPS edge.
process.argv.push('--https');
await import('./verify-phase4');

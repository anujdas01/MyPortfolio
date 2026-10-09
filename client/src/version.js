// Application version, injected at build/dev time from the root package.json
// via Vite's `define` (see client/vite.config.js). The typeof guard keeps this
// safe in contexts where the token isn't replaced (e.g. plain node unit tests).
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export default APP_VERSION;

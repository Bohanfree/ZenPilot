// Chrome 116+ supports promises for the extension APIs used here.
// Firefox keeps its native browser namespace.
if (!globalThis.browser) globalThis.browser = globalThis.chrome;

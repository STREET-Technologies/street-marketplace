// Request fixtures define their own origins. Deployment configuration must not
// override them; tests of the pinned-origin policy set it explicitly.
delete process.env.MARKETPLACE_ORIGIN;

// Local type aliases for the browser view's helper modules.
//
// The view receives the whole api surface through ViewContext.api (Window['api']); these
// helpers only need a slice of it. Deriving the alias from the global keeps them in sync
// with global.d.ts without importing App or the view registry.

export type Api = Window['api']

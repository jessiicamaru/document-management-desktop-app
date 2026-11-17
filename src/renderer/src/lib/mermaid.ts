// Loads Mermaid (only when a page has a diagram, it is big).
//
// d3, which Mermaid uses, declares itself free of side effects, so the bundler drops its
// import of "d3-transition" - the module that adds selection.transition(). Mermaid's
// tooltips need it ("tooltipElem.transition is not a function"), so load it ourselves first.
export async function loadMermaid(): Promise<typeof import('mermaid').default> {
  await import('d3-transition')
  return (await import('mermaid')).default
}

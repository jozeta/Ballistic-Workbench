/**
 * Ballistic Workbench - Guide view (placeholder; being written).
 */
export class GuideView {
  constructor(container) {
    this.container = container;
    this.render();
  }
  render() {
    this.container.innerHTML = '<header class="lg-header view-header"><div><h1 class="lg-title">Guide</h1><p class="lg-muted">From range day to a DOPE chart.</p></div></header>';
  }
  refresh() {
    this.render();
  }
  destroy() {}
}

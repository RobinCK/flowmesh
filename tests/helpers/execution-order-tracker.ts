export class ExecutionOrderTracker {
  private order: string[] = [];

  track(event: string): void {
    this.order.push(event);
  }

  getOrder(): string[] {
    return [...this.order];
  }

  clear(): void {
    this.order = [];
  }

  assertOrder(expected: string[]): void {
    expect(this.order).toEqual(expected);
  }

  assertContains(event: string): void {
    expect(this.order).toContain(event);
  }

  assertSequence(events: string[]): void {
    const indices = events.map(e => this.order.indexOf(e));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  }
}

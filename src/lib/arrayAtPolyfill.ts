export const installArrayAtPolyfill = (): void => {
  if (Array.prototype.at) return;

  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    writable: true,
    value<T>(this: T[], index: number): T | undefined {
      const normalized = Math.trunc(index) || 0;
      const position = normalized < 0 ? this.length + normalized : normalized;
      return position < 0 || position >= this.length ? undefined : this[position];
    },
  });
};

installArrayAtPolyfill();

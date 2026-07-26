export const z = {
  nonEmpty(value: string | undefined, name: string): string {
    const normalized = value?.trim();
    if (!normalized) throw new Error(`${name} is required`);
    return normalized;
  },
};

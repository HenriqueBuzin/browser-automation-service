export class WeightedSemaphore {
  readonly #queue: { resolve: (release: () => void) => void; weight: number }[] = [];
  #used = 0;

  public constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error("Semaphore capacity must be a positive integer");
    }
  }

  public acquire(weight: number): Promise<() => void> {
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > this.capacity) {
      return Promise.reject(new Error("Invalid semaphore weight"));
    }
    return new Promise((resolve) => {
      this.#queue.push({ resolve, weight });
      this.#drain();
    });
  }

  get available(): number {
    return this.capacity - this.#used;
  }

  #drain(): void {
    const next = this.#queue[0];
    if (!next || next.weight > this.available) return;
    this.#queue.shift();
    this.#used += next.weight;
    let released = false;
    next.resolve(() => {
      if (released) return;
      released = true;
      this.#used -= next.weight;
      this.#drain();
    });
  }
}

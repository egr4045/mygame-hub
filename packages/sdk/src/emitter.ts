export type Unsubscribe = () => void;

/** Minimal typed event emitter — zero deps, framework-agnostic. */
export class Emitter<Events> {
  private readonly listeners: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

  on<E extends keyof Events>(event: E, cb: (payload: Events[E]) => void): Unsubscribe {
    const set = (this.listeners[event] ??= new Set<(payload: Events[E]) => void>());
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    this.listeners[event]?.forEach((cb) => {
      cb(payload);
    });
  }
}

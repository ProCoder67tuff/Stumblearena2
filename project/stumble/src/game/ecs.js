/**
 * Small deterministic ECS used by the offline simulation and mirrored by the
 * network protocol. Entity iteration is always ascending by numeric id, which
 * makes replays and rollback tests stable across browsers.
 */
export class DeterministicECS {
  constructor() {
    this.nextId = 1;
    this.alive = new Set();
    this.components = new Map();
  }

  createEntity(preferredId = null) {
    const id = preferredId ?? this.nextId++;
    this.nextId = Math.max(this.nextId, id + 1);
    this.alive.add(id);
    return id;
  }

  destroyEntity(id) {
    this.alive.delete(id);
    for (const store of this.components.values()) store.delete(id);
  }

  addComponent(id, name, value) {
    if (!this.components.has(name)) this.components.set(name, new Map());
    this.components.get(name).set(id, value);
    return value;
  }

  getComponent(id, name) {
    return this.components.get(name)?.get(id);
  }

  removeComponent(id, name) {
    this.components.get(name)?.delete(id);
  }

  query(...names) {
    const entities = [...this.alive].sort((a, b) => a - b);
    return entities.filter((id) => names.every((name) => this.components.get(name)?.has(id)));
  }

  forEach(names, callback) {
    for (const id of this.query(...names)) callback(id, ...names.map((name) => this.components.get(name).get(id)));
  }

  snapshot() {
    const result = { nextId: this.nextId, alive: [...this.alive].sort((a, b) => a - b), components: {} };
    for (const [name, store] of this.components) {
      result.components[name] = [...store.entries()].sort(([a], [b]) => a - b);
    }
    return structuredClone(result);
  }

  restore(snapshot) {
    this.nextId = snapshot.nextId;
    this.alive = new Set(snapshot.alive);
    this.components.clear();
    for (const [name, entries] of Object.entries(snapshot.components)) this.components.set(name, new Map(entries));
  }
}

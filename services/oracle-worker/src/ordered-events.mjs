export class OrderedEvents {
  #entries = [];
  #progress = Promise.resolve();
  #workerFailure;
  #checkpointFailure;

  constructor(limit, process, checkpoint, onFailure = () => {}) {
    this.limit = limit;
    this.process = process;
    this.checkpoint = checkpoint;
    this.onFailure = onFailure;
  }

  async offer(event) {
    while (this.#entries.length >= this.limit && !this.#workerFailure && !this.#checkpointFailure) {
      await this.#entries[0].task;
      await this.#progress;
    }
    if (this.#workerFailure || this.#checkpointFailure) return false;
    const entry = { event, status: "pending" };
    this.#entries.push(entry);
    entry.task = Promise.resolve().then(() => this.process(event)).then(() => {
      entry.status = "complete";
      this.#advance();
    }, error => {
      entry.status = "failed";
      if (!this.#workerFailure) {
        this.#workerFailure = error;
        this.onFailure();
      }
    });
    return true;
  }

  #advance() {
    this.#progress = this.#progress.then(async () => {
      if (this.#checkpointFailure) return;
      while (this.#entries[0]?.status === "complete") {
        await this.checkpoint(this.#entries[0].event);
        this.#entries.shift();
      }
    }).catch(error => {
      this.#checkpointFailure = error;
      this.onFailure();
    });
  }

  async finish() {
    await Promise.all(this.#entries.map(entry => entry.task));
    await this.#progress;
    if (this.#checkpointFailure) throw this.#checkpointFailure;
    if (this.#workerFailure) throw this.#workerFailure;
  }
}

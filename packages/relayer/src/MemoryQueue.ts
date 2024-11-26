import { Mutex } from "async-mutex";
import { Logger } from "winston";
import { logger } from "./logger";

export class MemoryQueue<T> {
  queue: T[];
  mutex: Mutex;
  logger: Logger;
  constructor(label: string) {
    this.queue = [];
    this.mutex = new Mutex();
    this.logger = logger(label);
  }

  // Enqueue a job to the queue
  async enqueue(jobData: T) {
    const release = await this.mutex.acquire();
    try {
      this.queue.push(jobData);
      this.logger.debug(`Job added: ${JSON.stringify(jobData)}`);
    } finally {
      release(); // Release the lock
    }
  }

  async dequeue() {
    const release = await this.mutex.acquire();
    let job;
    try {
      job = this.queue.shift();
    } finally {
      release(); // Release the lock
    }
    return job;
  }

  // Dequeue a job (or all jobs) from the queue
  async dequeueAll() {
    const release = await this.mutex.acquire();
    let jobs = [];
    try {
      jobs = [...this.queue];
      this.queue = []; // Clear the queue after pulling all data
    } finally {
      release(); // Release the lock
    }
    return jobs;
  }

  // Get the current queue size
  async size() {
    const release = await this.mutex.acquire();
    let size;
    try {
      size = this.queue.length;
    } finally {
      release(); // Release the lock
    }
    return size;
  }
}

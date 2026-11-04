import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const INDEXING_QUEUE = 'indexing';
export const REALTIME_CHANNEL = 'patacerta:realtime';

export type IndexJob =
  | { kind: 'record'; id: string }
  | { kind: 'pet'; id: string }
  | { kind: 'appointment'; id: string }
  | { kind: 'delete'; sourceType: 'record' | 'pet' | 'appointment'; id: string };

export interface RealtimeEvent {
  /** Socket.io rooms that should receive the event, e.g. `user:<id>` or `staff`. */
  rooms: string[];
  event: string;
  payload: unknown;
}

/**
 * Bridges the API with the Node AI/realtime service.
 * - Durable work (indexing data for the assistant) goes through a BullMQ queue.
 * - Ephemeral notifications go through Redis pub/sub and are fanned out over WebSocket.
 */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private readonly redis: Redis;
  private readonly queue: Queue;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.redis = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true });
    this.queue = new Queue(INDEXING_QUEUE, {
      connection: new Redis(url, { maxRetriesPerRequest: null }),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }

  async index(job: IndexJob) {
    try {
      await this.queue.add(job.kind, job);
    } catch (err) {
      this.logger.warn(`Could not enqueue indexing job: ${(err as Error).message}`);
    }
  }

  async publish(event: RealtimeEvent) {
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      await this.redis.publish(REALTIME_CHANNEL, JSON.stringify(event));
    } catch (err) {
      this.logger.warn(`Could not publish realtime event: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
    this.redis.disconnect();
  }
}

import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { map, finalize } from 'rxjs/operators';

interface SseEvent {
  type: string;
  data: unknown;
}

// NestJS MessageEvent shape
interface MessageEvent {
  data: string | object;
  type?: string;
  id?: string;
  retry?: number;
}

@Injectable()
export class ReviewSseService {
  private readonly streams = new Map<string, Subject<SseEvent>>();

  createStream(reviewId: string): void {
    this.streams.set(reviewId, new Subject<SseEvent>());
  }

  emit(reviewId: string, type: string, data: unknown): void {
    const subject = this.streams.get(reviewId);
    if (subject) {
      subject.next({ type, data });
    }
  }

  complete(reviewId: string): void {
    const subject = this.streams.get(reviewId);
    if (subject) {
      subject.complete();
      this.streams.delete(reviewId);
    }
  }

  getStream(reviewId: string): Observable<MessageEvent> | null {
    const subject = this.streams.get(reviewId);
    if (!subject) return null;
    return subject.asObservable().pipe(
      map(
        (event): MessageEvent => ({
          type: event.type,
          data: JSON.stringify(event.data),
        }),
      ),
      finalize(() => this.streams.delete(reviewId)),
    );
  }
}

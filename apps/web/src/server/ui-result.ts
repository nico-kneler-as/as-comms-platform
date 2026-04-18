export interface UiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface UiError {
  ok: false;
  code: string;
  message: string;
  requestId: string;
  fieldErrors?: Record<string, string>;
  retryable?: boolean;
}

export type UiResult<T> = UiSuccess<T> | UiError;

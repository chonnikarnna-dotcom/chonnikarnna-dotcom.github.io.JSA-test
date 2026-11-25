import { AsyncLocalStorage } from 'async_hooks';

export type RequestContext = { requestId: string; ip?: string; userId?: string; userLabel?: string };
export const als = new AsyncLocalStorage<RequestContext>();
export const ctx = () => als.getStore();

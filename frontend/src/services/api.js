import { API } from '../config/constants';

export const getJson = async (path, options = {}) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const { timeoutMs, ...fetchOptions } = options;
  const isRead = !options.method || options.method === 'GET';
  const timeout = timeoutMs ?? (isRead ? 10000 : null);
  const timer = timeout == null ? null : window.setTimeout(abort, timeout);
  try {
    const response = await fetch(API + path, { ...fetchOptions, signal: controller.signal });
    if (!response.ok) {
      const failure = new Error((await response.text()) || response.statusText);
      failure.status = response.status;
      throw failure;
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error('Request timed out. Please retry.');
    throw error;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
};

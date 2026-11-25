import { API } from '../config/constants';

const sessionKey = 'foresight.access_token';
export const getToken = () => sessionStorage.getItem(sessionKey);
export const setToken = (token) => sessionStorage.setItem(sessionKey, token);
export const endSession = () => {
  sessionStorage.removeItem(sessionKey);
  window.dispatchEvent(new Event('foresight:sign-out'));
};

const request = async (path, options, read) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const { timeoutMs, authenticated = true, ...fetchOptions } = options;
  const token = authenticated ? getToken() : null;
  const headers = new Headers(fetchOptions.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const isRead = !options.method || options.method === 'GET';
  const timeout = timeoutMs ?? (isRead ? 10000 : null);
  const timer = timeout == null ? null : window.setTimeout(abort, timeout);
  try {
    const response = await fetch(API + path, { ...fetchOptions, headers, signal: controller.signal });
    if (!response.ok) {
      if (authenticated && response.status === 401 && token && token === getToken()) endSession();
      const failure = new Error((await response.text?.()) || response.statusText || 'Request failed');
      failure.status = response.status;
      throw failure;
    }
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error('Request timed out. Please retry.');
    throw error;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
};

export const getJson = (path, options = {}) => request(path, options, (response) => response.json());
export const getBlob = (path, options = {}) => request(path, options, (response) => response.blob());

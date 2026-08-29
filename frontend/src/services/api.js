import { API } from '../config/constants';

export const getJson = async (path, options) => {
  const response = await fetch(API + path, options);
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return response.json();
};
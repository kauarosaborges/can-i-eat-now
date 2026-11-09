import { ptBR } from './pt-BR.js';

export const LOCALE = 'pt-BR';

const dictionary = ptBR;

function resolve(key) {
  return key.split('.').reduce((node, part) => (node !== null && node !== undefined ? node[part] : undefined), dictionary);
}

export function t(key, params) {
  const value = resolve(key);
  if (typeof value !== 'string') return key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? String(params[name]) : match));
}

export function hasKey(key) {
  return typeof resolve(key) === 'string';
}

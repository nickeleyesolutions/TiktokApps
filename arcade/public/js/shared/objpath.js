// Small object helpers shared by the server (Node) and the stage (browser).
// No dependencies, so both sides can import this file directly.

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge src into target. Arrays and primitives replace; objects merge.
export function deepMerge(target, src) {
  if (!isPlainObject(src)) return target;
  for (const k of Object.keys(src)) {
    const sv = src[k];
    if (isPlainObject(sv)) {
      if (!isPlainObject(target[k])) target[k] = {};
      deepMerge(target[k], sv);
    } else {
      target[k] = sv;
    }
  }
  return target;
}

export function getPath(obj, path) {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

// Sets obj[a][b][c] = value for path "a.b.c". Refuses prototype keys.
export function setPath(obj, path, value) {
  const parts = String(path).split('.');
  if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) return false;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return true;
}

export function clone(v) {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

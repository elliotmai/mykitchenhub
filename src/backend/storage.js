// src/backend/storage.js
// Recipe photos, in Supabase Storage: bucket `kitchen`, under the household's
// folder (<household id>/recipes/<recipe id>/<file>). The screens keep saying
// ref(storage, 'recipes/…'); the household part is added here.

import { myHousehold, supabase } from './supabase';

const BUCKET = 'kitchen';
const STORAGE = { kind: 'storage' };
export const getStorage = () => STORAGE;

export const ref = (_storage, path = '') => ({
  kind: 'storageRef',
  path: String(path).replace(/^\/+/, ''),
});

const fail = (error) => {
  if (!error) return;
  const code = /exceeded|too large|size/i.test(error.message || '')
    ? 'storage/unauthorized'
    : /mime|type/i.test(error.message || '')
      ? 'storage/unauthorized'
      : /row-level|policy|permission/i.test(error.message || '')
        ? 'storage/unauthorized'
        : 'storage/unknown';
  throw Object.assign(new Error(error.message || 'Storage error'), { code });
};

const objectPath = async (r) => `${await myHousehold()}/${r.path}`;

export async function uploadBytes(r, file, metadata = {}) {
  const { error } = await supabase.storage.from(BUCKET).upload(await objectPath(r), file, {
    contentType: metadata.contentType || file?.type,
    upsert: true,
  });
  fail(error);
  return { ref: r, metadata };
}

export async function getDownloadURL(r) {
  return supabase.storage.from(BUCKET).getPublicUrl(await objectPath(r)).data.publicUrl;
}

export async function deleteObject(r) {
  const { error } = await supabase.storage.from(BUCKET).remove([await objectPath(r)]);
  fail(error);
}

// src/test-utils/mocks/storage.js
// Manual mock for `firebase/storage`.
//
// Uploads resolve immediately and downloads return a deterministic URL derived
// from the storage path, so assertions can check *which* path was written to.

export const getStorage = jest.fn(() => ({ __storage: true }));
export const connectStorageEmulator = jest.fn();

export const ref = jest.fn((_storage, path = '') => ({
  __path: path,
  fullPath: path,
  name: path.split('/').pop() ?? '',
}));

export const uploadBytes = jest.fn(async (storageRef) => ({
  ref: storageRef,
  metadata: { fullPath: storageRef?.__path ?? '', size: 1024, contentType: 'image/jpeg' },
}));

export const uploadBytesResumable = jest.fn((storageRef) => {
  const task = {
    snapshot: { ref: storageRef, bytesTransferred: 1024, totalBytes: 1024 },
    // Immediately report completion so components don't hang on progress.
    on: jest.fn((_event, _progress, _error, complete) => complete?.()),
    then: (resolve) => Promise.resolve({ ref: storageRef }).then(resolve),
    catch: () => task,
    cancel: jest.fn(),
  };
  return task;
});

export const getDownloadURL = jest.fn(
  async (storageRef) => `https://storage.test/${storageRef?.__path ?? 'file'}`
);
export const deleteObject = jest.fn(async () => undefined);
export const listAll = jest.fn(async () => ({ items: [], prefixes: [] }));

export const __reset = () => {
  uploadBytes.mockImplementation(async (storageRef) => ({
    ref: storageRef,
    metadata: { fullPath: storageRef?.__path ?? '', size: 1024, contentType: 'image/jpeg' },
  }));
  getDownloadURL.mockImplementation(
    async (storageRef) => `https://storage.test/${storageRef?.__path ?? 'file'}`
  );
  deleteObject.mockImplementation(async () => undefined);
};

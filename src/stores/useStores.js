// src/stores/useStores.js
// The household's stores, and where each item is usually bought
// (./storeLogic.js has the rules).

import { useCallback, useEffect, useMemo, useState } from 'react';

import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from '../backend/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../hooks/useAuth';
import { friendlyError } from '../utils/firebaseErrors';
import { NO_STORE, itemStoreKey, newStoreId, sortStores, storeFor } from './storeLogic';

const useStores = () => {
  const { user } = useAuth();
  const [stores, setStores] = useState([]);
  const [memory, setMemory] = useState({});

  useEffect(() => {
    if (!user?.uid) {
      setStores([]);
      setMemory({});
      return undefined;
    }
    const offStores = onSnapshot(collection(db, 'stores'), (snap) =>
      setStores(sortStores(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    );
    const offMemory = onSnapshot(collection(db, 'itemStores'), (snap) =>
      setMemory(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])))
    );
    return () => {
      offStores();
      offMemory();
    };
  }, [user?.uid]);

  const storeOf = useCallback((item) => storeFor(item, memory, stores), [memory, stores]);

  const addStore = useCallback(
    async (name) => {
      const clean = String(name ?? '').trim();
      if (!clean) return { success: false, error: 'Give the store a name.' };
      if (stores.some((s) => s.name.toLowerCase() === clean.toLowerCase())) {
        return { success: false, error: `${clean} is already on the list.` };
      }
      const id = newStoreId(clean, stores);
      try {
        await setDoc(doc(db, 'stores', id), { name: clean.slice(0, 60), order: stores.length });
        return { success: true, id };
      } catch (err) {
        return { success: false, error: friendlyError(err, { action: 'add that store' }) };
      }
    },
    [stores]
  );

  const removeStore = useCallback(async (id) => {
    try {
      await deleteDoc(doc(db, 'stores', id));
      return { success: true };
    } catch (err) {
      return { success: false, error: friendlyError(err, { action: 'remove that store' }) };
    }
  }, []);

  /**
   * Send a line to a store, and remember it for that item next time. A typed
   * line (with an id of its own) also carries the store itself.
   */
  const setStore = useCallback(
    async (item, storeId) => {
      const store = storeId && storeId !== NO_STORE ? storeId : null;
      try {
        await setDoc(
          doc(db, 'itemStores', itemStoreKey(item.name || item.normalized)),
          { store, name: String(item.name || '').slice(0, 120) },
          { merge: true }
        );
        if (item.id && item.status !== undefined) {
          await updateDoc(doc(db, 'users', user?.uid || 'me', 'shoppingItems', item.id), { store });
        }
        return { success: true };
      } catch (err) {
        return { success: false, error: friendlyError(err, { action: 'change the store' }) };
      }
    },
    [user?.uid]
  );

  /** Where a new line with this name should go: where it was bought last. */
  const usualStore = useCallback(
    (name) => {
      const id = memory[itemStoreKey(name)]?.store;
      return id && stores.some((s) => s.id === id) ? id : null;
    },
    [memory, stores]
  );

  return useMemo(
    () => ({ stores, memory, storeOf, addStore, removeStore, setStore, usualStore }),
    [stores, memory, storeOf, addStore, removeStore, setStore, usualStore]
  );
};

export default useStores;

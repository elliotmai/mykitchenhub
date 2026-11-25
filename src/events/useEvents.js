// src/events/useEvents.js
// The household's events (kitchen.docs 'events/<id>'), live.

import { useCallback, useEffect, useState } from 'react';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from '../backend/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../hooks/useAuth';
import { friendlyError } from '../utils/firebaseErrors';
import { newEvent } from './eventLogic';

const useEvents = () => {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) {
      setEvents([]);
      setLoading(false);
      return undefined;
    }
    return onSnapshot(
      collection(db, 'events'),
      (snap) => {
        setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(friendlyError(err, { action: 'load your events' }));
        setLoading(false);
      }
    );
  }, [user?.uid]);

  const create = useCallback(async (input) => {
    const event = newEvent(input);
    if (!event) return { success: false, error: 'Give the event a name.' };
    try {
      const ref = await addDoc(collection(db, 'events'), {
        ...event,
        createdAt: serverTimestamp(),
      });
      return { success: true, id: ref.id };
    } catch (err) {
      return { success: false, error: friendlyError(err, { action: 'add that event' }) };
    }
  }, []);

  /** Save a changed event (from eventLogic's helpers). */
  const save = useCallback(async (event) => {
    const { id, ...data } = event;
    try {
      await setDoc(doc(db, 'events', id), data);
      return { success: true };
    } catch (err) {
      return { success: false, error: friendlyError(err, { action: 'save that event' }) };
    }
  }, []);

  const remove = useCallback(async (id) => {
    try {
      await deleteDoc(doc(db, 'events', id));
      return { success: true };
    } catch (err) {
      return { success: false, error: friendlyError(err, { action: 'delete that event' }) };
    }
  }, []);

  return { events, loading, error, create, save, remove };
};

export default useEvents;

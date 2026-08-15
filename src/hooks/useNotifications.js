// src/hooks/useNotifications.js
// In-app notifications — roadmap 6.2.
//
// The daily waste-alert function writes here whether or not an SMS went out,
// so the alerts are useful even with no SMS provider configured. Documents
// live at users/{uid}/notifications/{notificationId}.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  limit as limitTo,
  updateDoc,
} from 'firebase/firestore';

import { db } from '../services/firebase';
import { useAuth } from './useAuth';
import { friendlyError } from '../utils/firebaseErrors';

/** How many notifications to keep on screen. */
export const NOTIFICATION_PAGE_SIZE = 25;

const useNotifications = ({ type = null, max = NOTIFICATION_PAGE_SIZE } = {}) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const ref = collection(db, 'users', user.uid, 'notifications');
    const q = query(ref, orderBy('createdAt', 'desc'), limitTo(max));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setNotifications(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching notifications:', err);
        setError(friendlyError(err, { action: 'load your alerts' }));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, max]);

  const visible = useMemo(
    () => (type ? notifications.filter((n) => n.type === type) : notifications),
    [notifications, type]
  );

  const unreadCount = useMemo(() => visible.filter((n) => !n.read).length, [visible]);

  const markAsRead = useCallback(
    async (notificationId) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      try {
        await updateDoc(doc(db, 'users', user.uid, 'notifications', notificationId), {
          read: true,
        });
        return { success: true };
      } catch (err) {
        console.error('Error marking notification read:', err);
        return { success: false, error: friendlyError(err, { action: 'mark that as read' }) };
      }
    },
    [user?.uid]
  );

  const dismiss = useCallback(
    async (notificationId) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'notifications', notificationId));
        return { success: true };
      } catch (err) {
        console.error('Error dismissing notification:', err);
        return { success: false, error: friendlyError(err, { action: 'dismiss that alert' }) };
      }
    },
    [user?.uid]
  );

  return { notifications: visible, loading, error, unreadCount, markAsRead, dismiss };
};

export default useNotifications;

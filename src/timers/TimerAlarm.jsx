// src/timers/TimerAlarm.jsx
// On screen when a timer is done: what finished, and a big Stop. Stopping
// deletes the timer, which silences it on every device in the household.

import React from 'react';
import { Button } from 'react-bootstrap';
import { BellRing } from 'lucide-react';

import { useTimers } from './TimersProvider';
import { audioReady } from './ringer';

const TimerAlarm = () => {
  const { ringing, stop, stopAll } = useTimers();
  if (!ringing.length) return null;

  return (
    <div
      className="kitchen-timer-alarm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="timer-alarm-title"
    >
      <div className="kitchen-timer-alarm__card">
        <BellRing size={40} aria-hidden="true" className="kitchen-timer-alarm__bell" />
        <h2 id="timer-alarm-title" className="h4 mb-3">
          {ringing.length === 1
            ? `${ringing[0].label} is done`
            : `${ringing.length} timers are done`}
        </h2>
        {ringing.length > 1 && (
          <ul className="list-unstyled mb-3">
            {ringing.map((t) => (
              <li
                key={t.id}
                className="d-flex align-items-center justify-content-between gap-3 mb-2"
              >
                <span>{t.label}</span>
                <Button size="sm" variant="outline-light" onClick={() => stop(t.id)}>
                  Stop
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          size="lg"
          variant="light"
          className="w-100"
          onClick={() => (ringing.length === 1 ? stop(ringing[0].id) : stopAll())}
        >
          {ringing.length === 1 ? 'Stop' : 'Stop all'}
        </Button>
        {!audioReady() && (
          <p className="small mt-3 mb-0">
            Tap anywhere on this screen so it can ring out loud next time.
          </p>
        )}
      </div>
    </div>
  );
};

export default TimerAlarm;
